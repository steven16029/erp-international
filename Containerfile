FROM quay.io/sclorg/nodejs-20-c9s:latest AS builder
ENV NPM_CONFIG_CACHE=/tmp/.npm
WORKDIR /opt/app-root/src
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN mkdir -p public src/services && \
    mv -f index.html env-config.js public/ 2>/dev/null || true && \
    mv -f App.jsx index.js App.css index.css src/ 2>/dev/null || true && \
    mv -f redhatAuth.js src/services/ 2>/dev/null || true && \
    npm run build

FROM quay.io/nginx/nginx-unprivileged:latest
COPY --from=builder /opt/app-root/src/build /usr/share/nginx/html
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
