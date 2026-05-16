FROM node:22-alpine

WORKDIR /app

# Prisma needs openssl on Alpine
RUN apk add --no-cache openssl

COPY package*.json ./
RUN npm install

COPY prisma ./prisma
RUN npx prisma generate

COPY . .
RUN npm run build

# Render sets PORT at runtime (usually 10000)
ENV NODE_ENV=production
EXPOSE 10000

CMD ["sh", "-c", "if [ -z \"$DATABASE_URL\" ]; then echo 'ERROR: DATABASE_URL is not set. Add it in Render Environment.'; exit 1; fi && npx prisma migrate deploy && node dist/index.js"]
