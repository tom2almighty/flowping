# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM golang:1.27-alpine AS build
ARG TARGETOS TARGETARCH TARGETVARIANT VERSION=docker
RUN apk add --no-cache ca-certificates
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH GOARM=${TARGETVARIANT#v} \
    go build -trimpath -ldflags="-s -w -X main.version=$VERSION" -o /out/flowping-agent ./cmd/agent

# The agent reads /proc and /sys of the host, so run it with
# --net host --pid host -v /:/host:ro
FROM scratch
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=build /out/flowping-agent /flowping-agent
ENV FLOWPING_ROOT=/host
ENTRYPOINT ["/flowping-agent"]
