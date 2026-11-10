FROM nginx:1.27-alpine

# The collection builder places the complete, self-contained static site in
# ./site before this image is built.
COPY site/ /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
