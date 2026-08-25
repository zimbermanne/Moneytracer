FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

# ── IMPORTANT: Set VITE_API_URL on Railway as a build-time variable ──
# e.g.  VITE_API_URL=https://adminwebappbackend-production.up.railway.app
#
# This value is baked into the JS bundle at build time. If it's not set,
# all /api/* requests will stay relative and nginx will return index.html
# instead of forwarding to the backend — that's the "Could not reach the
# server" error you see after deploy.
ARG VITE_API_URL=https://adminwebappbackend-production.up.railway.app
ENV VITE_API_URL=$VITE_API_URL
RUN echo "Building with VITE_API_URL=${VITE_API_URL}" && npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf
COPY templates/default.conf.template /etc/nginx/templates/default.conf.template
ENV PORT=80
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
