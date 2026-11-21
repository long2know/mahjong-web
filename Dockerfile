FROM docker.io/library/node:26.13.1-bookworm-slim@sha256:5df79989ed685e09f0a98019db4cebfb22fb9df1a53c0161664a011f7ff6b0f1 AS client
WORKDIR /build/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM mcr.microsoft.com/dotnet/sdk:10.0.404-noble@sha256:bef136a371963aaa46ec97882845ef6f54dec15728bb4b128b1c2a400ffbc9b4 AS publish
WORKDIR /build
COPY global.json Directory.Build.props Directory.Build.targets ./
COPY src/Mahjong.Rules/Mahjong.Rules.csproj src/Mahjong.Rules/packages.lock.json src/Mahjong.Rules/
COPY src/Mahjong.Server/Mahjong.Server.csproj src/Mahjong.Server/packages.lock.json src/Mahjong.Server/
RUN dotnet restore src/Mahjong.Server/Mahjong.Server.csproj -p:RestoreLockedMode=true

COPY src/ src/
COPY LICENSE ./
COPY scripts/licenses/ scripts/licenses/
COPY --from=client /build/web/dist/ web/dist/
ARG BUILD_VERSION=0.1.0
ARG SOURCE_COMMIT=unknown
RUN dotnet publish src/Mahjong.Server/Mahjong.Server.csproj -c Release --no-restore -o /out \
      -p:UseAppHost=false -p:ContinuousIntegrationBuild=true \
      -p:Version="$BUILD_VERSION" -p:InformationalVersion="$BUILD_VERSION+$SOURCE_COMMIT" \
      -p:IncludeSourceRevisionInInformationalVersion=false \
    && test -s /out/index.html

FROM mcr.microsoft.com/dotnet/aspnet:10.0.15-noble@sha256:12b1135f5f8b3c0a214f2a680ff2033dff4f684f445d6c697d9524ceeb303586 AS runtime
ARG BUILD_VERSION=0.1.0
ARG SOURCE_COMMIT=unknown
LABEL org.opencontainers.image.title="Mahjong Web" \
      org.opencontainers.image.source="https://github.com/long2know/mahjong-web" \
      org.opencontainers.image.version="$BUILD_VERSION" \
      org.opencontainers.image.revision="$SOURCE_COMMIT"
ENV ASPNETCORE_HTTP_PORTS=8080 \
    Mahjong__DataDirectory=/data
WORKDIR /app
RUN install -d -o app -g app -m 0700 /data /data/keys
COPY --from=publish /out/ ./
USER $APP_UID
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=3 \
  CMD ["bash", "-ec", "exec 3<>/dev/tcp/127.0.0.1/8080; printf 'GET %s/health/ready HTTP/1.1\\r\\nHost: localhost\\r\\nConnection: close\\r\\n\\r\\n' \"${BASE_URL%/}\" >&3; IFS=' ' read -r proto status rest <&3; test \"$status\" = 200"]
ENTRYPOINT ["dotnet", "Mahjong.Server.dll"]
