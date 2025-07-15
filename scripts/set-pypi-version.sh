#!/usr/bin/env bash

# Script to bump version in all relevant files

set -e

# Default options
N_COUNT=0

# Function to show usage
usage() {
    echo "Usage: $0 [-n] [new_version]"
    echo "  new_version: Version to set (e.g., 0.0.5)"
    echo "               If not provided, will auto-increment patch version"
    echo ""
    echo "Options:"
    echo "  -n     Update files and commit, but don't tag"
    echo "  -nn    Update files only, don't commit or tag"
    echo "  -nnn   Dry run - show what would be done without making any changes"
    echo "  -h     Show this help message"
    exit 1
}

# Parse options
while getopts "nh" opt; do
    case $opt in
        n)
            N_COUNT=$((N_COUNT + 1))
            ;;
        h)
            usage
            ;;
        \?)
            echo "Invalid option: -$OPTARG" >&2
            usage
            ;;
    esac
done

# Shift past the options
shift $((OPTIND-1))

# Get current version from pyproject.toml
get_current_version() {
    grep '^version = ' pyproject.toml | sed 's/version = "\(.*\)"/\1/'
}

# Auto-increment patch version
increment_patch() {
    local version=$1
    local major=$(echo $version | cut -d. -f1)
    local minor=$(echo $version | cut -d. -f2)
    local patch=$(echo $version | cut -d. -f3)
    echo "${major}.${minor}.$((patch + 1))"
}

# Check for uncommitted changes (skip if N_COUNT >= 3)
if [ $N_COUNT -lt 3 ] && ! git diff-index --quiet HEAD --; then
    echo "Error: You have uncommitted changes. Please commit or stash them first."
    echo "Current changes:"
    git status --short
    exit 1
fi

# Get current version
current_version=$(get_current_version)

if [ -z "$current_version" ]; then
    echo "Error: Could not find current version in pyproject.toml"
    exit 1
fi

echo "Current version: $current_version"

# Determine new version
if [ $# -eq 0 ]; then
    new_version=$(increment_patch $current_version)
    echo "Auto-incrementing to: $new_version"
elif [ $# -eq 1 ]; then
    new_version=$1
    echo "Setting version to: $new_version"
else
    usage
fi

# Validate version format (basic check)
if ! [[ $new_version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Error: Version must be in format X.Y.Z (e.g., 0.0.5)"
    exit 1
fi

# Files to update
files=(
    "README.md"
    "www/README.md"
    "pyproject.toml"
)

if [ $N_COUNT -ge 3 ]; then
    echo "[DRY RUN] Would update version from $current_version to $new_version in:"
else
    echo "Updating version from $current_version to $new_version in:"
fi

# Update each file
for file in "${files[@]}"; do
    if [ -f "$file" ]; then
        echo "  - $file"
        if [ $N_COUNT -lt 3 ]; then
            # Use perl to replace version, escaping dots for regex
            current_escaped=$(echo "$current_version" | sed 's/\./\\./g')
            perl -pi -e "s/$current_escaped/$new_version/g" "$file"
        fi
    else
        echo "  - $file (not found, skipping)"
    fi
done

if [ $N_COUNT -lt 3 ]; then
    echo "Version bump complete!"
fi

# Git commit and tag
if [ $N_COUNT -ge 3 ]; then
    echo ""
    echo "[DRY RUN] Would perform the following Git operations:"
    echo "  - git add ${files[@]}"
    echo "  - git commit -m 'v$new_version'"
    if [ $N_COUNT -eq 0 ]; then
        echo "  - git tag 'v$new_version'"
    fi
elif [ $N_COUNT -ge 2 ]; then
    echo ""
    echo "Files updated. Skipping Git operations."
else
    echo ""
    echo "Creating commit..."

    # Stage the changes
    git add "${files[@]}"

    # Commit with version message
    git commit -m "v$new_version"

    # Create tag if N_COUNT is 0
    if [ $N_COUNT -eq 0 ]; then
        echo "Creating tag..."
        git tag "v$new_version"
    fi

    echo ""
    echo "Success! Version $new_version has been:"
    echo "  ✓ Updated in all files"
    echo "  ✓ Committed with message 'v$new_version'"
    if [ $N_COUNT -eq 0 ]; then
        echo "  ✓ Tagged as 'v$new_version'"
    fi
fi

echo ""
echo "Next steps:"
if [ $N_COUNT -ge 3 ]; then
    echo "  1. Run without -nnn to actually make changes"
elif [ $N_COUNT -eq 2 ]; then
    echo "  1. Files have been updated"
    echo "  2. Commit manually if needed: git add ${files[@]} && git commit -m 'v$new_version'"
    echo "  3. Create tag manually if needed: git tag v$new_version"
elif [ $N_COUNT -eq 1 ]; then
    echo "  1. Push changes: git push"
    echo "  2. Create tag manually if needed: git tag v$new_version"
else
    echo "  1. Push changes: git push"
    echo "  2. Push tag: git push origin v$new_version"
    echo "  3. (Optional) Push all at once: git push && git push --tags"
fi
