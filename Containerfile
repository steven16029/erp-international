FROM ://redhat.com AS builder
ENV NPM_CONFIG_CACHE=/tmp/.npm
WORKDIR /opt/app-root/src
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

FROM quay.io/nginx/nginx-unprivileged:latest
COPY --from=builder /opt/app-root/src/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
