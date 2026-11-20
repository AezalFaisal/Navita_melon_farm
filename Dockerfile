# Navita Melon Farm - virtual tour (website + multiplayer socket) in one container.
#   docker build -t navita-melon-farm .
#   docker run -d -p 3000:3000 --name navita --restart unless-stopped navita-melon-farm
# Then open http://<server-address>:3000

# ---- stage 1: build the website ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY src ./src
COPY public ./public
RUN npm run build

# ---- stage 2: small runtime image ----
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY server ./server
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "server/index.js"]
