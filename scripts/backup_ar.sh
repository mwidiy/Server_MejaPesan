#!/bin/bash

# Configuration
SOURCE_DIR="/var/www/meja-pesan-server/public/ar-assets"
BACKUP_DIR="/var/www/backups/ar-assets"
DATE=$(date +%Y-%m-%d_%H-%M-%S)
BACKUP_FILE="ar_assets_backup_$DATE.tar.gz"

# Ensure backup directory exists
mkdir -p "$BACKUP_DIR"

echo "Starting AR Assets backup: $DATE"

# Create a compressed tarball
tar -czf "$BACKUP_DIR/$BACKUP_FILE" -C "$SOURCE_DIR" .

# Keep only the last 7 backups (Cleanup)
find "$BACKUP_DIR" -type f -name "ar_assets_backup_*.tar.gz" -mtime +7 -delete

echo "Backup completed: $BACKUP_FILE"
