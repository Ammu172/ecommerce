FROM nginx:alpine

# Copy frontend files
COPY . /usr/share/nginx/html/

# Copy nginx config from a file
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

