# ---------- Etapa 1: compilar React con Red Hat UBI 9 Node.js ----------
FROM registry.access.redhat.com/ubi9/nodejs-20:latest AS builder
WORKDIR /opt/app-root/src

# CI=false: que los warnings de ESLint no rompan el build; sin sourcemaps para ahorrar memoria
ENV CI=false \
    GENERATE_SOURCEMAP=false \
    NODE_OPTIONS=--max-old-space-size=768

COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

# ---------- Etapa 2: servir con Red Hat UBI 9 Nginx (sin root) ----------
FROM registry.access.redhat.com/ubi9/nginx-124:latest

COPY --from=builder /opt/app-root/src/build /opt/app-root/src
COPY nginx.conf /etc/nginx/nginx.conf

USER 1001
EXPOSE 8080
CMD ["nginx", "-e", "/dev/stderr", "-g", "daemon off;"]
