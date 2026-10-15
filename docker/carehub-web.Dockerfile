# CareHub web image. The app is already built by the GitHub workflow
# (.github/workflows/carehub-web-image.yml); this only packs it into nginx.
FROM nginx:1.25-alpine

RUN apk add --no-cache tini

COPY dist /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/nginx.conf
COPY entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 80
ENTRYPOINT ["/sbin/tini", "--", "/docker-entrypoint.sh"]
