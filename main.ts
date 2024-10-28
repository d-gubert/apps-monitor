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
  input: URL | Request | string,
  init?: RequestInit,
): Promise<Response> {
  try {
    let _input = input;

    if (typeof input === "string") {
      _input = `${Config.serverURL}${input}`;
    }

    const _init = {
      ...(init || {}),
      headers: {
        "X-User-Id": Config.userId,
        "X-Auth-Token": Config.userPAT,
        ...(init?.headers || {})
      },
    };

    const response = await fetch(_input, _init);

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
      console.error(
        `Error trying to connect to server at ${Config.serverURL} - check your configuration file`,
      );
    }

    throw e;
  }

  throw new Error("Invalid path", { cause: "ERR_INVALID_FUNCTION_PATH" });
}

export function getServerInfo() {
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
  const response = await api("/api/v1/instances.get");

  const data = (await response.json()) as { instances: Array<InstanceData> };

  const result: InstancesResponse = {};

  for (const instance of data.instances) {
    result[instance.instanceRecord._id] = instance;
  }

  return result;
}

export type AppsResponse = Array<{
  id: string;
  version: string;
  name: string;
  status: string;
}>;

export async function getAppsInInstance(instance: InstanceData) {
  const targetUrl = new URL("/api/apps/installed", `http://${instance.address}`);
  targetUrl.port = instance.instanceRecord.extraInformation.port;

  const response = await api(targetUrl);

  const data = (await response.json()) as { apps: AppsResponse };

  return data.apps;
}

export async function changeAppStatusInInstance(instance: InstanceData, appId: string) {
  const targetUrl = new URL(`/api/apps/${appId}/status`, `http://${instance.address}`);
  targetUrl.port = instance.instanceRecord.extraInformation.port;

  const request: RequestInit = {
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'post',
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
}

export async function getClusterAppsData(instanceMap: InstancesResponse) {
  const instances = Object.values(instanceMap);

  const clusterApps: Record<string, AppInstancesInfo> = {};

  for (const instance of instances) {
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
      if (!prevInstance || prevInstance.status === currentInstance.status) continue;

      clusterApps[app.id].isDirty = true;
    }
  }

  console.log(clusterApps);

  return clusterApps;
}

export async function main() {
  const instanceMap = await getInstances();

  console.log(instanceMap);

  const instances = Object.values(instanceMap);

  const clusterApps = await getClusterAppsData(instanceMap);

  for (const appInfo of Object.values(clusterApps)) {
    if (!appInfo.isDirty && appInfo.instances.length === instances.length) continue;

    for (const instance of appInfo.instances) {
      if (instance.status === 'enabled' || instance.status === 'manually_enabled') continue;

      const result = await changeAppStatusInInstance(instanceMap[instance.id], appInfo.appId);

      console.log({ result });
    }
  }
}

await main();
