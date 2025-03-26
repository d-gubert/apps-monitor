import { pino } from 'npm:pino';
import { getInstances } from './microservices.ts';

export const logger = pino({
	level: Deno.env.get('LOG_LEVEL') || 'info',
});

export type ConfigFile = {
	userId: string;
	userPAT: string;
	serverURL?: string;
	interval?: number;
	alertRoom?: string;
};

export type TExecutionContext = {
	configFilePath: string;
	interval: number;
	userPAT: string;
	userId: string;
	serverURL?: URL;
	alertRoom?: string;
};

const ExecutionContext: TExecutionContext = {
	configFilePath: './apps-monitor-config.json',
	interval: 5 * 1000 * 60, // 5 minutes default interval
	userPAT: '',
	userId: '',
};

try {
	const configFile = JSON.parse(
		Deno.readTextFileSync(ExecutionContext.configFilePath),
	) as ConfigFile;

	if (configFile.interval && isFinite(configFile.interval)) {
		const configInterval = Number(configFile.interval);

		if (configInterval < 30000) {
			logger.warn(
				'Configured interval %d is too short, ignoring.',
				configInterval,
			);
		} else {
			ExecutionContext.interval = configInterval;
		}
	}

	if (!configFile.userPAT) {
		throw new Error('Invalid personal access token (userPAT)');
	}

	ExecutionContext.userPAT = configFile.userPAT;

	if (!configFile.userId) {
		throw new Error('Invalid user id (userId)');
	}

	ExecutionContext.userId = configFile.userId;

	if (configFile.serverURL) {
		ExecutionContext.serverURL = new URL(configFile.serverURL);
	}

	if (configFile.alertRoom) {
		ExecutionContext.alertRoom = configFile.alertRoom;
	} else {
		logger.warn(
			"No alert room specified, we won't be able to send message",
		);
	}
} catch (e) {
	let error = '';

	if (e instanceof Error) {
		error = e.message;
	}

	logger.fatal({ msg: 'Could not parse configuration file', error });
	Deno.exit(1);
}

export type InstanceData = {
	id: string;
	address: string;
	port: number;
};

export type InstanceMap = Map<string, InstanceData>;

export async function api(
	input: URL | string,
	init?: RequestInit,
): Promise<Response> {
	logger.trace({ params: { input, init } }, 'api');

	let url: URL | undefined;

	if (typeof input === 'string') {
		url = new URL(input, ExecutionContext.serverURL!);
	} else {
		url = input;
	}

	const _init = {
		...(init || {}),
		headers: {
			'X-User-Id': ExecutionContext.userId,
			'X-Auth-Token': ExecutionContext.userPAT,
			...(init?.headers || {}),
		},
	};

	try {
		logger.trace({ params: { url, _init } }, 'fetch()');

		const response = await fetch(url, _init);

		if (response.headers.get('content-type') !== 'application/json') {
			throw new Error(
				`Invalid content type "${
					response.headers.get('content-type')
				}"`,
				{ cause: 'ERR_UNKNOWN_CONTENT_TYPE' },
			);
		}

		if (response.status === 401) {
			throw new Error(`Invalid authentication`, {
				cause: 'ERR_INVALID_CONFIG',
			});
		}

		if (response.status === 403) {
			throw new Error(`Unauthorized access`, {
				cause: 'ERR_INVALID_CONFIG',
			});
		}

		return response;
	} catch (e: unknown) {
		if (e instanceof TypeError) {
			logger.fatal(
				`Error trying to connect to server at ${url.protocol}//${url.host} - check your configuration file`,
			);
		}

		throw e;
	}
}

export type AppsResponse = Array<{
	id: string;
	version: string;
	name: string;
	status: string;
}>;

export async function getAppsInInstance(instance: InstanceData) {
	logger.trace({ params: { instance } }, 'getAppsInInstance');

	logger.debug(
		`Fetching apps from ${instance.address} (${instance.id})`,
	);

	const targetUrl = new URL(
		'/api/apps/installed',
		`http://${instance.address}`,
	);
	targetUrl.port = String(instance.port);

	const response = await api(targetUrl);

	const data = (await response.json()) as { apps: AppsResponse };

	return data.apps;
}

export async function changeAppStatusInInstance(
	instance: InstanceData,
	appId: string,
) {
	logger.trace({ params: { instance, appId } }, 'changeAppStatusInInstance');

	const targetUrl = new URL(
		`/api/apps/${appId}/status`,
		`http://${instance.address}`,
	);
	targetUrl.port = String(instance.port);
	// targetUrl.protocol = ExecutionContext.serverURL!.protocol;

	const request: RequestInit = {
		headers: {
			'Content-Type': 'application/json',
		},
		method: 'post',
		body: JSON.stringify({ status: 'manually_enabled' }),
	};

	const response = await api(targetUrl, request);

	const result = await response.json();

	return result;
}

export async function sendAlertMessage(
	appName: string,
	instance: InstanceData,
) {
	logger.trace({ appName, instance }, 'sendAlertMessage');

	if (!ExecutionContext.alertRoom) {
		logger.warn(
			'Needed to send alert message, but no room has been configured (alertRoom)',
		);
		return;
	}

	const request: RequestInit = {
		headers: {
			'Content-Type': 'application/json',
		},
		method: 'post',
		body: JSON.stringify({
			message: {
				rid: ExecutionContext.alertRoom,
				msg: `Failed attempt to recover app ${appName} on instance ${instance.address} (${instance.id})`,
			},
		}),
	};

	try {
		const response = await api('/api/v1/chat.sendMessage', request);

		if (!response.ok) {
			logger.error({
				msg: `Failed to send alert message to configured room (${ExecutionContext.alertRoom})`,
				response: await response.json(),
			});
		}
	} catch (e) {
		if (e instanceof Error) {
			logger.error(
				{ error: e.message, cause: e.cause },
				`Failed to send alert message to configured room (${ExecutionContext.alertRoom})`,
			);
		}
	}
}

export type AppInstancesInfo = {
	appId: string;
	appName: string;
	isDirty: boolean;
	instances: Array<{
		id: string;
		status: string;
	}>;
};

export async function getClusterAppsData(map: InstanceMap) {
	logger.trace({ params: { map } }, 'getClusterAppsData');

	logger.debug('Fetching apps data in cluster');

	const clusterApps: Record<string, AppInstancesInfo> = {};

	const controlQueue: Promise<void>[] = [];

	map.forEach((instance) =>
		controlQueue.push((async () => {
			logger.debug(
				`Fetching apps in instance ${instance.address} (${instance.id})`,
			);

			const apps = await getAppsInInstance(instance);

			for (const app of apps) {
				clusterApps[app.id] = clusterApps[app.id] ?? {
					appId: app.id,
					appName: app.name,
					isDirty: false,
					instances: [],
				};

				const prevInstance = clusterApps[app.id].instances.at(-1);
				const currentInstance = {
					id: instance.id,
					status: app.status,
				};

				clusterApps[app.id].instances.push(currentInstance);

				// NOTE: this doesn't catch the case where the app is not installed in one instance of the cluster
				// Do we care about this behavior?
				if (
					!prevInstance ||
					prevInstance.status === currentInstance.status
				) {
					logger.debug(
						'App %s in instance %s shows no conflict (status %s)',
						app.name,
						instance.address,
						app.status,
					);

					continue;
				}

				logger.debug(
					'App %s is dirty! (instance %s)',
					app.name,
					instance.address,
				);

				clusterApps[app.id].isDirty = true;
			}
		})())
	);

	await Promise.all(controlQueue);

	// console.log(clusterApps);
	logger.trace({ msg: 'Cluster apps data', clusterApps });

	return Object.values(clusterApps);
}

export async function synchronizeApps(
	clusterApps: Array<AppInstancesInfo>,
	map: InstanceMap,
) {
	logger.trace({ clusterApps, map }, 'executeAppSync');

	const instanceCount = map.size;

	const fixedApps = new Set();
	let fixedConflicts = 0;

	for (const appInfo of clusterApps) {
		logger.debug('Checking app %s across cluster...', appInfo.appName);

		if (!appInfo.isDirty && appInfo.instances.length === instanceCount) {
			logger.debug(
				'App %s is synchronized across cluster',
				appInfo.appName,
			);
			continue;
		}

		for (const instance of appInfo.instances) {
			logger.debug('Instance %s', instance.id);

			const instanceData = map.get(instance.id);

			if (!instanceData) continue;

			if (
				instance.status === 'enabled' ||
				instance.status === 'manually_enabled'
			) {
				logger.debug(
					'App %s is enabled in instance %s',
					appInfo.appName,
					instance.id,
				);
				continue;
			}

			logger.debug(
				'Trying to enable app %s in instance %s ...',
				appInfo.appName,
				instance.id,
			);

			const result = await changeAppStatusInInstance(
				instanceData,
				appInfo.appId,
			);

			await sendAlertMessage(appInfo.appName, instanceData);

			if (result.success) {
				fixedApps.add(appInfo.appId);
				fixedConflicts++;

				logger.info(
					'App %s was successfully enabled in instance %s',
					appInfo.appName,
					instance.id,
				);
			} else {
				logger.error({
					msg: `Error trying to enable app ${appInfo.appName}`,
					error: result.error,
				});
			}
		}
	}

	const result = {
		fixedApps: fixedApps.size,
		fixedConflicts: fixedConflicts,
	};

	logger.trace(result, 'App sync result');

	return result;
}

export async function main() {
	logger.info(
		`Initiating check for workspace ${ExecutionContext.serverURL || ''}`,
	);

	const instanceMap = await getInstances();

	if (instanceMap.size < 2) {
		logger.info(
			{ instances: instanceMap.size },
			'Only one instance found in workspace, aborting...',
		);

		return;
	}

	logger.info('Found %d instances in cluster', instanceMap.size);

	const clusterApps = await getClusterAppsData(instanceMap);

	logger.info('Found %s apps in cluster', clusterApps.length);

	const { fixedConflicts, fixedApps } = await synchronizeApps(
		clusterApps,
		instanceMap,
	);

	if (fixedConflicts < 1) {
		logger.info('Check concluded, no conflicting status found');
	} else {
		logger.info(
			'Check concluded, fixed %d apps (%d conflicts)',
			fixedApps,
			fixedConflicts,
		);
	}
}

await main();

logger.info(
	'Setting interval for %d seconds',
	ExecutionContext.interval / 1000,
);

setInterval(() => main(), ExecutionContext.interval);

Deno.addSignalListener('SIGINT', () => {
	logger.info('SIGINT received, good bye!');
	Deno.exit(0);
});
