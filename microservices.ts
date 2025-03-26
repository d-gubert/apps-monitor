import { exec } from 'node:child_process';
import type { Pod } from 'npm:kubernetes-types/core/v1';

import { InstanceMap } from './main.ts';

export async function getInstances(): Promise<InstanceMap> {
	const kubectlRaw = await new Promise<string>((resolve, reject) => {
		exec(
			'kubectl get pods -A -o json',
			(error: Error | null, stdout: string) => {
				if (error) {
					reject(error);
				}

				resolve(stdout);
			},
		);
	});

	const result: InstanceMap = new Map();

	const { items } = (() => {
		try {
			return JSON.parse(kubectlRaw);
		} catch (cause) {
			throw new Error('Could not parse kubectl output', { cause });
		}
	})() as { items: Pod[] };

	items.forEach((pod) => {
		const id = pod.metadata?.name;
		const address = pod.status?.podIP;
		const port = pod.spec?.containers?.[0].ports?.[0].containerPort;

		// The only pods we're interested in are the ones with core chat instances
		if (!id?.startsWith('rocketchat-') || !port || !address) {
			return;
		}

		result.set(id, {
			address,
			id,
			port,
		});
	});

	return result;
}
