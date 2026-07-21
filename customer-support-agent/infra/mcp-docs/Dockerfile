FROM supercorp/supergateway

COPY docs/ /docs/

EXPOSE 8082

CMD ["--stdio", "npx -y @modelcontextprotocol/server-filesystem /docs", \
     "--port", "8082", \
     "--baseUrl", "http://localhost:8082", \
     "--ssePath", "/sse", \
     "--messagePath", "/message"]
