FROM denoland/deno:alpine

RUN apk add --no-cache kubectl
    # For debug builds
    # sudo vim curl

COPY . /app/monitor

WORKDIR /app/monitor

CMD [ "deno", "run", "-A", "main.ts" ]
