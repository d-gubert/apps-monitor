import { logger, api } from './main.ts';

export type GetInfoResponse = {
	version: string;
	minimumClientVersions: string;
	supportedVersions: {
		signed: string;
	};
	cloudWorkspaceId: string;
	success: boolean;
};

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
	logger.trace('getInstances');

	const response = await api('/api/v1/instances.get');

	const data = await response.json();

	if (!data.success && data.error) {
		throw new Error(data.error, {
			cause: 'ERR_INSTANCE_DATA_NOT_AVAILABLE',
		});
	}

	const result: InstancesResponse = {};

	for (const instance of data.instances) {
		result[instance.instanceRecord._id] = instance;
	}

	logger.trace({ msg: 'Instance result', result });

	return result;
}

export function getServerInfo() {
	logger.trace('getServerInfo');

	return void api('/api/info');
}

