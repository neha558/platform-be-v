FROM node:16.16.0-slim
WORKDIR /app
COPY . .
RUN apt update -y
RUN npm install 
RUN npm run build 
EXPOSE 3009
CMD ["npm", "start", "prod"]

