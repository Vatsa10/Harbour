pull_version=${VERSION:-$(curl -s https://api.github.com/repos/Vatsa10/Harbour/tags | grep '"name":' | head -n 1 | cut -d '"' -f 4)}

if [[ -z "$pull_version" ]]; then
  echo "Error: Unable to fetch the latest version tag. Please check your network connection or the GitHub API response."
  exit 1
fi
pull_branch=${BRANCH:-$pull_version}

version_num=${pull_version#v}
target_version="0.32.4"

# We moved the install script to a different location in v0.32.4
if [[ -n "$BRANCH" ]] || [[ "$(printf '%s\n' "$target_version" "$version_num" | sort -V | head -n1)" != "$version_num" ]]; then
  curl -sL "https://raw.githubusercontent.com/Vatsa10/Harbour/$pull_branch/packages/searm-docker/scripts/install.sh" -o searm_install.sh
else
  curl -sL "https://raw.githubusercontent.com/Vatsa10/Harbour/$pull_branch/install.sh" -o searm_install.sh
fi

chmod +x searm_install.sh
VERSION="$VERSION" BRANCH="$BRANCH" ./searm_install.sh

rm searm_install.sh
