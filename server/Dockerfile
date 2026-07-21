# Works on Railway, Fly.io, or any host that runs a Dockerfile.
# For Render, use render.yaml instead — it also provisions the database for you.
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
