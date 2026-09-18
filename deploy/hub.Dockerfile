# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM oven/bun:1 AS web
WORKDIR /src/web
COPY web/package.json web/bun.lock* ./
RUN bun install --frozen-lockfile
COPY web ./
RUN bun run build

FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS build
ARG TARGETOS TARGETARCH TARGETVARIANT VERSION=docker
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=web /src/web/dist ./web/dist
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH GOARM=${TARGETVARIANT#v} \
    go build -trimpath -ldflags="-s -w -X main.version=$VERSION" -o /out/flowping-hub ./cmd/hub

FROM alpine:3
RUN apk add --no-cache ca-certificates
COPY --from=build /out/flowping-hub /usr/local/bin/flowping-hub
ENV FLOWPING_LISTEN=:8080 FLOWPING_DATA=/data
VOLUME /data
EXPOSE 8080
ENTRYPOINT ["flowping-hub"]
