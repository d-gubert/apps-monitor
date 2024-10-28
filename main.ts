import { pino } from "npm:pino";

const logger = pino({
  level: Deno.env.get('LOG_LEVEL') || "info",
});

export type ConfigFile = {
  userId: string;
  userPAT: string;
  serverURL: string;
};

/* Config Admin */
const Config: ConfigFile = {
  userPAT: "NonIfSuzWFzEPA2RB7slUGp-ubNtLGZy78aWwIWjWpt",
  userId: "YzrFwYjd7qDAhArBZ",
  serverURL: "http://172.19.0.5",
};

/* Config User */
// const Config: ConfigFile = {
//   userPAT: "JPKtVV5GyTjtbKEo1FrYF5yAFzuD8nQRYJyOV4zw3o3",
//   userId: "BSW2AdATpn9PTP78n",
//   serverURL: "http://localhost:3000",
// }

export type GetInfoResponse = {
  version: string;
  minimumClientVersions: string;
  supportedVersions: {
    signed: string;
  };
  cloudWorkspaceId: string;
  success: boolean;
};

export async function api(
  input: URL | string,
  init?: RequestInit,
): Promise<Response> {
  logger.trace({ input, init }, "api");

  let url: URL | undefined;

  if (typeof input === "string") {
    url = new URL(input, Config.serverURL);
  } else {
    url = input;
  }

  const _init = {
    ...(init || {}),
    headers: {
      "X-User-Id": Config.userId,
      "X-Auth-Token": Config.userPAT,
      ...(init?.headers || {}),
    },
  };

  try {
    logger.trace({ url, _init }, "fetch()");

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
      throw new Error(`Unauthorized access`, { cause: "ERR_INVALID_CONFIG" });
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

export function getServerInfo() {
  logger.trace('getServerInfo');

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
    throw new Error(data.error, { cause: "ERR_INSTANCE_DATA_NOT_AVAILABLE" });
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
  logger.trace({ params: { instance } }, 'getAppsInInstance');

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
  logger.trace({ params: { instance, appId } }, 'changeAppStatusInInstance');

  const targetUrl = new URL(
    `/api/apps/${appId}/status`,
    `http://${instance.address}`,
  );
  targetUrl.port = instance.instanceRecord.extraInformation.port;

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
  logger.trace({ params: { instanceMap } }, 'getClusterAppsData');

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
      if (!prevInstance || prevInstance.status === currentInstance.status) {
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

  return clusterApps;
}

export async function main() {
  logger.info(`Initiating check for workspace ${Config.serverURL}`);

  const instanceMap = await getInstances();

  const instances = Object.values(instanceMap);

  if (instances.length < 2) {
    logger.info(
      { instances },
      "Only one instance found in workspace, aborting...",
    );
    return;
  }

  logger.info('Found %d instances in cluster', instances.length);

  const clusterApps = await getClusterAppsData(instanceMap);

  const fixedApps = new Set();
  let fixedInstances = 0;

  for (const appInfo of Object.values(clusterApps)) {
    logger.debug("Checking app %s across cluster...", appInfo.appName);

    if (!appInfo.isDirty && appInfo.instances.length === instances.length) {
      logger.debug("App %s is synchronized across cluster", appInfo.appName);
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

      if (result.success) {
        fixedApps.add(appInfo.appId);
        fixedInstances++;

        logger.info(
          "App %s was successfully enabled in instance %s",
          appInfo.appName,
          instance.id,
        );
      } else {
        logger.error({ msg: `Error trying to enable app ${appInfo.appName}`, error: result.error });
      }
    }
  }

  if (fixedInstances < 1) {
    logger.info('Check concluded, no conflicting status found');
  } else {
    logger.info('Check concluded, fixed %d apps (%d conflicts)', fixedApps.size, fixedInstances);
  }
}

await main();

/**
 * @TODO start interval call
 * @TODO read config file
 * @TODO send a message to a channel in Rocket.Chat if fails to enable an app
 * @TODO log summary after every check
 * @TODO pino-pretty output by default, disable via env var
 *
 */
