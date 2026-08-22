#!/bin/sh

if [ -z "$REACT_APP_SERVER_BASE_URL" ]; then
  echo "Error: REACT_APP_SERVER_BASE_URL is not set."
  exit 1
fi

echo "Injecting runtime environment variables into index.html..."

CONFIG_BLOCK=$(cat << EOF
    <script id="searm-env-config">
      window._env_ = {
        REACT_APP_SERVER_BASE_URL: "$REACT_APP_SERVER_BASE_URL"
      };
    </script>
    <!-- END: SeaRM Config -->
EOF
)
# Use sed to replace the config block in index.html
# Using pattern space to match across multiple lines
echo "$CONFIG_BLOCK" | sed -i.bak '
  /<!-- BEGIN: SeaRM Config -->/,/<!-- END: SeaRM Config -->/{
    /<!-- BEGIN: SeaRM Config -->/!{
      /<!-- END: SeaRM Config -->/!d
    }
    /<!-- BEGIN: SeaRM Config -->/r /dev/stdin
    /<!-- END: SeaRM Config -->/d
  }
' build/index.html
rm -f build/index.html.bak
