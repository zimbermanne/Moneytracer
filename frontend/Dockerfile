FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
# Baked in at build time so the built JS bundle calls the backend directly
# instead of falling back to relative /api/... paths (which nginx's SPA
# fallback turns into 405s, since it serves index.html for any non-file
# route regardless of HTTP method).
ARG VITE_API_URL=https://adminwebappbackend-production.up.railway.app
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf
COPY templates/default.conf.template /etc/nginx/templates/default.conf.template
ENV PORT=80
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
