FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG FRONTEND_DEBUG=True
ENV FRONTEND_DEBUG=$FRONTEND_DEBUG
# Public address of the site: link previews (Telegram, Discord ...) need absolute addresses for their image.
ARG SITE_URL=
ENV SITE_URL=$SITE_URL
RUN npm run build

FROM alpine:3.22
COPY --from=build /app/dist /dist
CMD ["sh", "-c", "rm -rf /out/* && cp -R /dist/. /out/ && chown -R \"$HOST_UID:$HOST_GID\" /out"]
