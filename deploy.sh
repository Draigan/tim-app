#!/bin/bash
set -e

npm run build
rsync -avz --delete dist/ matrix:/var/www/timberfell-app/
echo "Deployed to app.timberfell.ca"
