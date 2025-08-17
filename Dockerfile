# Root Dockerfile (frontend)
FROM node:20-alpine
WORKDIR /usr/src/app

# Install deps with cache
COPY package*.json ./
RUN npm ci

# Copy the rest of the app
COPY . .

EXPOSE 8080
CMD ["npm","run","dev","--","--host","0.0.0.0","--port","8080"]
