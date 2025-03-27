# Apps Monitor

<!--toc:start-->

- [Apps Monitor](#apps-monitor)
  - [Configuration](#configuration)
  - [Running](#running) - [Server access](#server-access)
  <!--toc:end-->

We're currently investigating an issue where some apps might show inconsistent status across the instances of a cluster. While we look for the root cause of this issue, this tool helps mitigate the impacts of the instability on environments.

This tool monitors via the network the Rocket.Chat apps that are installed in a given Rocket.Chat high-availability cluster, trying to keep their status as enabled whenever there is some inconsistency. If it is not possible to fix this automatically, a message can be sent to a provided room explaining the problem.

## Configuration

Configuration can be provided in two ways:

Either a file `apps-monitor-config.json` to be in the same directory from where the tool is executed.
This is an example config for that file:

```json
{
  "userPAT": "NonIfSuzWFzEPA2RB7slUGp-ubNtLGZy78aWwIWjWpt",
  "userId": "YzrFwYjd7qDAhArBZ",
  "serverURL": "http://172.19.0.5",
  "interval": 30000,
  "alertRoom": "671feba8af417d3edd6dbf30",
  "appId": "55ecd482-392f-447a-8fdc-a44b371ff794"
}
```

Or by providing the configuration as environment variables:

```sh
USER_ID=YzrFwYjd7qDAhArBZ
USER_PAT=NonIfSuzWFzEPA2RB7slUGp-ubNtLGZy78aWwIWjWpt
INTERVAL_MS=30000
APP_ID=55ecd482-392f-447a-8fdc-a44b371ff794
```

- `userPAT` - the personal access token (PAT) of a user with admin permissions. _This token needs to be created with the "Ignore two factor authentication" option selected_. To learn more about creating a PAT see the following page <https://docs.rocket.chat/v1/docs/account#personal-access-tokens>
- `userId` - the id of the user that created the PAT. This is provided during the PAT creation.
- `serverURL` - Optional. The base URL to access the workspace
- `interval` - Optional. Determines the interval between monitor checks to the cluster, in milliseconds (default: 30000 (5min))
- `alertRoom` - Optional. The room id to where the monitor will send a message in case of errors when trying to enable an app.
- `appId` - Optional. The id of the app to be monitored. If not provided, the tool will monitor all apps in the cluster.

## Running

You can use deno to run this tool:

```sh
deno run main.ts
```

Deno will ask for some permissions that are required for it to interact with the environment. If you want to allow all those permissions, use the `-A` option

```sh
$ deno run -A main.ts

# or the following list of permissions if you don't want to provide ALL available

$ deno run --allow-env --allow-read --allow-sys --allow-net main.ts
```

By default, if no `serverURL` is provided, the tool will try to interact with `kubectl` to discover the instances it needs to monitor. For this the tool needs to running inside a pod in the same cluster it is monitoring.

To monitor a cluster deployed in High Availability mode, the configuration MUST include the `serverURL` field. This is because the tool needs to know the IP addresses of the other instances in the cluster to be able to reach them.

The log level can be configured via the `LOG_LEVEL` environment variable.

```sh
LOG_LEVEL=trace deno run main.ts
```

### Server access

The tool needs to be able to reach the server address that has been configured _AND the IP addressess of each individual instance of the cluster as well_ to fully work.
