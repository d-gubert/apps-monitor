import { pino } from "npm:pino";

const logger = pino({
    level: Deno.env.get("LOG_LEVEL") || "info",
});

export type ConfigFile = {
    userId: string;
    userPAT: string;
    serverURL: string;
    interval?: number;
    alertRoom?: string;
};

export type TExecutionContext = {
    configFilePath: string;
    interval: number;
    userPAT: string;
    userId: string;
    serverURL: URL | null;
    alertRoom?: string;
};

const ExecutionContext: TExecutionContext = {
    configFilePath: "./apps-monitor-config.json",
    interval: 5 * 1000 * 60, // 5 minutes default interval
    userPAT: "",
    userId: "",
    serverURL: null,
};

try {
    const configFile = JSON.parse(
        Deno.readTextFileSync(ExecutionContext.configFilePath),
    ) as ConfigFile;

    if (configFile.interval && isFinite(configFile.interval)) {
        const configInterval = Number(configFile.interval);

        if (configInterval < 30000) {
            logger.warn(
                "Configured interval %d is too short, ignoring.",
                configInterval,
            );
        } else {
            ExecutionContext.interval = configInterval;
        }
    }

    if (!configFile.userPAT) {
        throw new Error("Invalid personal access token (userPAT)");
    }

    ExecutionContext.userPAT = configFile.userPAT;

    if (!configFile.userId) {
        throw new Error("Invalid user id (userId)");
    }

    ExecutionContext.userId = configFile.userId;

    if (!configFile.serverURL) {
        throw new Error("Invalid server URL (serverURL)");
    }

    ExecutionContext.serverURL = new URL(configFile.serverURL);

    if (configFile.alertRoom) {
        ExecutionContext.alertRoom = configFile.alertRoom;
    } else {
        logger.warn(
            "No alert room specified, we won't be able to send message",
        );
    }
} catch (e) {
    let error: string = "";

    if (e instanceof Error) {
        error = e.message;
    }

    logger.fatal({ msg: "Could not parse configuration file", error });
    Deno.exit(1);
}

export async function api(
    input: URL | string,
    init?: RequestInit,
): Promise<Response> {
    logger.trace({ params: { input, init } }, "api");

    let url: URL | undefined;

    if (typeof input === "string") {
        url = new URL(input, ExecutionContext.serverURL!);
    } else {
        url = input;
    }

    const _init = {
        ...(init || {}),
        headers: {
            "X-User-Id": ExecutionContext.userId,
            "X-Auth-Token": ExecutionContext.userPAT,
            ...(init?.headers || {}),
        },
    };

    try {
        logger.trace({ params: { url, _init } }, "fetch()");

        const response = await fetch(url, _init);

        if (response.headers.get("content-type") !== "application/json") {
            throw new Error(
                `Invalid content type "${response.headers.get("content-type")}"`,
                { cause: "ERR_UNKNOWN_CONTENT_TYPE" },
            );
        }

        if (response.status === 401) {
            throw new Error(`Invalid authentication`, {
                cause: "ERR_INVALID_CONFIG",
            });
        }

        if (response.status === 403) {
            throw new Error(`Unauthorized access`, {
                cause: "ERR_INVALID_CONFIG",
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

    throw new Error("Invalid path", { cause: "ERR_INVALID_FUNCTION_PATH" });
}

export type GetInfoResponse = {
    version: string;
    minimumClientVersions: string;
    supportedVersions: {
        signed: string;
    };
    cloudWorkspaceId: string;
    success: boolean;
};

export function getServerInfo() {
    logger.trace("getServerInfo");

    return void api("/api/info");
}

export type InstanceData = {
    address: string;
    currentStatus: {
        connected: boolean;
        lastHeartbeatTime: number;
        local: boolean;
    };
    instanceRecord: {
        _id: string;
        _createdAt: string;
        _updatedAt: string;
        extraInformation: {
            host: string;
            port: string;
            tcpPort: number;
            nodeVersion: string;
            conns: number;
        };
        name: string;
        pid: number;
    };
    broadcastAuth: boolean;
};

export type InstancesResponse = Record<string, InstanceData>;

export async function getInstances(): Promise<InstancesResponse> {
    logger.trace("getInstances");

    const response = await api("/api/v1/instances.get");

    const data = await response.json();

    if (!data.success && data.error) {
        throw new Error(data.error, {
            cause: "ERR_INSTANCE_DATA_NOT_AVAILABLE",
        });
    }

    const result: InstancesResponse = {};

    for (const instance of data.instances) {
        result[instance.instanceRecord._id] = instance;
    }

    logger.trace({ msg: "Instance result", result });

    return result;
}

export type AppsResponse = Array<{
    id: string;
    version: string;
    name: string;
    status: string;
}>;

export async function getAppsInInstance(instance: InstanceData) {
    logger.trace({ params: { instance } }, "getAppsInInstance");

    logger.debug(
        `Fetching apps from ${instance.address} (${instance.instanceRecord._id})`,
    );

    const targetUrl = new URL(
        "/api/apps/installed",
        `http://${instance.address}`,
    );
    targetUrl.port = instance.instanceRecord.extraInformation.port;

    const response = await api(targetUrl);

    const data = (await response.json()) as { apps: AppsResponse };

    return data.apps;
}

export async function changeAppStatusInInstance(
    instance: InstanceData,
    appId: string,
) {
    logger.trace({ params: { instance, appId } }, "changeAppStatusInInstance");

    const targetUrl = new URL(
        `/api/apps/${appId}/status`,
        `http://${instance.address}`,
    );
    targetUrl.port = instance.instanceRecord.extraInformation.port;
    targetUrl.protocol = ExecutionContext.serverURL!.protocol;

    const request: RequestInit = {
        headers: {
            "Content-Type": "application/json",
        },
        method: "post",
        body: JSON.stringify({ status: "manually_enabled" }),
    };

    const response = await api(targetUrl, request);

    const result = await response.json();

    return result;
}

export async function sendAlertMessage(
    appName: string,
    instance: InstanceData,
) {
    logger.trace({ appName, instance }, "sendAlertMessage");

    if (!ExecutionContext.alertRoom) {
        logger.warn(
            "Needed to send alert message, but no room has been configured (alertRoom)",
        );
        return;
    }

    const request: RequestInit = {
        headers: {
            "Content-Type": "application/json",
        },
        method: "post",
        body: JSON.stringify({
            message: {
                rid: ExecutionContext.alertRoom,
                msg: `Failed attempt to recover app ${appName} on instance ${instance.address} (${instance.instanceRecord._id})`,
            },
        }),
    };

    try {
        const response = await api("/api/v1/chat.sendMessage", request);

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

export async function getClusterAppsData(instanceMap: InstancesResponse) {
    logger.trace({ params: { instanceMap } }, "getClusterAppsData");

    logger.debug("Fetching apps data in cluster");

    const instances = Object.values(instanceMap);

    const clusterApps: Record<string, AppInstancesInfo> = {};

    for (const instance of instances) {
        logger.debug(
            `Fetching apps in instance ${instance.address} (${instance.instanceRecord._id})`,
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
                id: instance.instanceRecord._id,
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
                    "App %s in instance %s shows no conflict (status %s)",
                    app.name,
                    instance.address,
                    app.status,
                );

                continue;
            }

            logger.debug(
                "App %s is dirty! (instance %s)",
                app.name,
                instance.address,
            );

            clusterApps[app.id].isDirty = true;
        }
    }

    // console.log(clusterApps);
    logger.trace({ msg: "Cluster apps data", clusterApps });

    return Object.values(clusterApps);
}

export async function executeAppSync(
    clusterApps: Array<AppInstancesInfo>,
    instanceMap: InstancesResponse,
) {
    logger.trace({ clusterApps, instanceMap }, "executeAppSync");

    const instanceCount = Object.keys(instanceMap).length;
    const fixedApps = new Set();
    let fixedConflicts = 0;

    for (const appInfo of clusterApps) {
        logger.debug("Checking app %s across cluster...", appInfo.appName);

        if (!appInfo.isDirty && appInfo.instances.length === instanceCount) {
            logger.debug(
                "App %s is synchronized across cluster",
                appInfo.appName,
            );
            continue;
        }

        for (const instance of appInfo.instances) {
            logger.debug("Instance %s", instance.id);

            if (
                instance.status === "enabled" ||
                instance.status === "manually_enabled"
            ) {
                logger.debug(
                    "App %s is enabled in instance %s",
                    appInfo.appName,
                    instance.id,
                );
                continue;
            }

            logger.debug(
                "Trying to enable app %s in instance %s ...",
                appInfo.appName,
                instance.id,
            );

            const result = await changeAppStatusInInstance(
                instanceMap[instance.id],
                appInfo.appId,
            );

            await sendAlertMessage(appInfo.appName, instanceMap[instance.id]);

            if (result.success) {
                fixedApps.add(appInfo.appId);
                fixedConflicts++;

                logger.info(
                    "App %s was successfully enabled in instance %s",
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

    logger.trace(result, "App sync result");

    return result;
}

export async function main() {
    logger.info(`Initiating check for workspace ${ExecutionContext.serverURL}`);

    const instanceMap = await getInstances();

    const instanceCount = Object.keys(instanceMap).length;

    if (instanceCount < 2) {
        logger.info(
            { instances: instanceCount },
            "Only one instance found in workspace, aborting...",
        );
        return;
    }

    logger.info("Found %d instances in cluster", instanceCount);

    const clusterApps = await getClusterAppsData(instanceMap);

    logger.info("Found %s apps in cluster", clusterApps.length);

    const { fixedConflicts, fixedApps } = await executeAppSync(
        clusterApps,
        instanceMap,
    );

    if (fixedConflicts < 1) {
        logger.info("Check concluded, no conflicting status found");
    } else {
        logger.info(
            "Check concluded, fixed %d apps (%d conflicts)",
            fixedApps,
            fixedConflicts,
        );
    }
}

await main();

logger.info(
    "Setting interval for %d seconds",
    ExecutionContext.interval / 1000,
);

setInterval(() => main(), ExecutionContext.interval);

Deno.addSignalListener("SIGINT", () => {
    logger.info("Interrupt received, shutting down. Bye!");
    Deno.exit(0);
});
