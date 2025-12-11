#!/bin/bash
# Initialize user config file if it doesn't exist
# This ensures the Next.js app has valid LLM configuration for export functionality

CONFIG_PATH="${USER_CONFIG_PATH:-/app_data/userConfig.json}"
CONFIG_DIR=$(dirname "$CONFIG_PATH")

# Create directory if it doesn't exist
mkdir -p "$CONFIG_DIR"

# Create default config if file doesn't exist
if [ ! -f "$CONFIG_PATH" ]; then
  echo "Creating default user config at $CONFIG_PATH"
  cat > "$CONFIG_PATH" <<EOF
{
  "LLM": "openai",
  "OPENAI_MODEL": "gpt-4.1-mini",
  "OPENAI_API_KEY": "sk-dummy",
  "DISABLE_IMAGE_GENERATION": true
}
EOF
  echo "✅ Default user config created"
else
  echo "✅ User config already exists at $CONFIG_PATH"
fi


