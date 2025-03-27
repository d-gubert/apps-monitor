import { ConfigFile, logger, TExecutionContext } from './main.ts';

export function parseConfigFromFile(filePath: string): Partial<ConfigFile> {
	try {
		return JSON.parse(
			Deno.readTextFileSync(filePath),
		) as ConfigFile;
	} catch (e) {
		let error = '';

		if (e instanceof Error) {
			error = e.message;
		}

		logger.fatal({ msg: 'Could not parse configuration file', error });
		Deno.exit(1);
	}
}

export function parseConfigFromEnv(): Partial<ConfigFile> {
	return {
		interval: Deno.env.get('INTERVAL_MS')
			? Number(Deno.env.get('INTERVAL_MS'))
			: 5 * 1000 * 60,
		userPAT: Deno.env.get('USER_PAT') || '',
		userId: Deno.env.get('USER_ID') || '',
		alertRoom: Deno.env.get('ALERT_ROOM') || '',
		appId: Deno.env.get('APP_ID') || '',
		serverURL: Deno.env.get('SERVER_URL') || '',
	};
}

export function parseConfig(): TExecutionContext {
	const config: TExecutionContext = {
		interval: 5 * 1000 * 60,
		userPAT: '',
		userId: '',
	};

	let configFile;

	try {
		Deno.lstatSync('apps-monitor-config.json');
		configFile = parseConfigFromFile('apps-monitor-config.json');
		config.source = 'file';
	} catch (err) {
		if (!(err instanceof Deno.errors.NotFound)) {
			throw err;
		}

		configFile = parseConfigFromEnv();
		config.source = 'env';
	}

	if (configFile.interval && isFinite(configFile.interval)) {
		const configInterval = Number(configFile.interval);

		if (configInterval < 30000) {
			logger.warn(
				'Configured interval %d is too short, ignoring.',
				configInterval,
			);
		} else {
			config.interval = configInterval;
		}
	}

	if (!configFile.userPAT) {
		throw new Error(`Invalid personal access token ${config.source}`);
	}

	config.userPAT = configFile.userPAT;

	if (!configFile.userId) {
		throw new Error(`Invalid user id from ${config.source}`);
	}

	config.userId = configFile.userId;

	if (configFile.serverURL) {
		config.serverURL = new URL(configFile.serverURL);
	}

	if (configFile.alertRoom) {
		config.alertRoom = configFile.alertRoom;
	} else {
		logger.warn(
			"No alert room specified, we won't be able to send message",
		);
	}

	if (configFile.appId) {
		logger.warn(
			`App id received - watching restricted to ${configFile.appId}`,
		);

		config.appId = configFile.appId;
	}

	return config;
}
