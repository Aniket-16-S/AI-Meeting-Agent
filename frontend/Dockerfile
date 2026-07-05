# Stage 1: Build
FROM node:18-alpine AS builder
ARG NEXT_PUBLIC_BACKEND_URL=http://backend:8000
ENV NEXT_PUBLIC_BACKEND_URL=$NEXT_PUBLIC_BACKEND_URL
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Stage 2: Production
FROM node:18-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Only copy the built files
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.js ./next.config.js


EXPOSE 3000
CMD ["npm", "start"]