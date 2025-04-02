FROM denoland/deno:alpine

RUN apk add --no-cache kubectl
    # For debug builds
    # sudo vim curl

COPY . /app/monitor

WORKDIR /app/monitor

RUN deno cache main.ts

CMD [ "deno", "run", "--allow-run", "--allow-env", "--allow-read", "--allow-sys", "--allow-net", "main.ts" ]
