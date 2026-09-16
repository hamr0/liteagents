#!/bin/bash

# Version Update Script for liteagents
# Updates version across all files and creates git tag

if [ -z "$1" ]; then
    echo "❌ Error: Version number required"
    echo "Usage: ./UPDATE_VERSION.sh <version>"
    echo "Example: ./UPDATE_VERSION.sh 1.1.0"
    exit 1
fi

NEW_VERSION=$1

echo "🔄 Updating liteagents to version $NEW_VERSION..."
echo ""

# 1. Update package.json
echo "📦 Updating package.json..."
sed -i "s/\"version\": \".*\"/\"version\": \"$NEW_VERSION\"/" package.json

# 2. Update all plugin manifests
echo "🔌 Updating plugin manifests..."
sed -i "s/\"version\": \".*\"/\"version\": \"$NEW_VERSION\"/" .claude-plugin/plugin.json
sed -i "s/\"version\": \".*\"/\"version\": \"$NEW_VERSION\"/" .claude-plugin/plugin-lite.json
sed -i "s/\"version\": \".*\"/\"version\": \"$NEW_VERSION\"/" .claude-plugin/plugin-standard.json
sed -i "s/\"version\": \".*\"/\"version\": \"$NEW_VERSION\"/" .claude-plugin/plugin-pro.json
sed -i "s/\"version\": \".*\"/\"version\": \"$NEW_VERSION\"/" .claude-plugin/marketplace.json

# 3. Update KNOWLEDGE_BASE.md
echo "📚 Updating KNOWLEDGE_BASE.md..."
sed -i "s/Last Updated: .* | Version: .*/Last Updated: $(date +'%B %Y') | Version: $NEW_VERSION/" KNOWLEDGE_BASE.md
sed -i "s/\*\*Version:\*\* .*/\*\*Version:\*\* $NEW_VERSION/" KNOWLEDGE_BASE.md

echo ""
echo "✅ Version updated to $NEW_VERSION in:"
echo "   - package.json"
echo "   - .claude-plugin/plugin.json"
echo "   - .claude-plugin/plugin-lite.json"
echo "   - .claude-plugin/plugin-standard.json"
echo "   - .claude-plugin/plugin-pro.json"
echo "   - .claude-plugin/marketplace.json"
echo "   - KNOWLEDGE_BASE.md"
echo ""
echo "📝 Next steps:"
echo "   1. Update CHANGELOG.md with release notes"
echo "   2. Commit changes: git add . && git commit -m \"Bump version to $NEW_VERSION\""
echo "   3. Create git tag: git tag v$NEW_VERSION"
echo "   4. Push to GitHub: git push origin main --tags"
echo "   5. Publish to npm: npm publish --access public"
