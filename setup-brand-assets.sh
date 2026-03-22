#!/bin/bash

# ============================================================================
# Transilvania Times - Brand Assets Setup Script
# ============================================================================
# This script sets up professional logos and favicons in your GitHub repo
# ============================================================================

set -e  # Exit on error

echo "======================================================================"
echo "🎨 Transilvania Times - Brand Assets Setup"
echo "======================================================================"
echo ""

# Define paths
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PUBLIC_DIR="$REPO_ROOT/public"
ASSETS_DIR="$PUBLIC_DIR/assets"
LOGOS_DIR="$ASSETS_DIR/logos"
FAVICONS_DIR="$ASSETS_DIR/favicons"

# Create directories
echo "📁 Creating directory structure..."
mkdir -p "$LOGOS_DIR"
mkdir -p "$FAVICONS_DIR"
echo "✓ Directories created"
echo ""

# Create main horizontal logo SVG
echo "🎨 Creating horizontal logo..."
cat > "$LOGOS_DIR/transilvania-times-logo.svg" << 'EOF'
<svg viewBox="0 0 1000 300" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="goldGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#D4AF37;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#AA8C1A;stop-opacity:1" />
    </linearGradient>
    <linearGradient id="redGradient" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" style="stop-color:#C41E3A;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#8B1428;stop-opacity:1" />
    </linearGradient>
    <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
      <feDropShadow dx="2" dy="2" stdDeviation="3" flood-opacity="0.2"/>
    </filter>
  </defs>
  <rect width="1000" height="300" fill="#FFFFFF"/>
  <g id="mark" filter="url(#shadow)">
    <path d="M 80 60 L 80 140 Q 80 180 130 210 Q 180 180 180 140 L 180 60 Z" fill="url(#redGradient)" stroke="#8B1428" stroke-width="2"/>
    <g transform="translate(130, 100)">
      <path d="M -35 -25 L -15 -25 L -15 35 L -35 35 Z" fill="#FFFFFF" opacity="0.9"/>
      <path d="M 5 -25 L 35 -25 L 35 35 L 5 35 Z" fill="#FFFFFF" opacity="0.85"/>
      <line x1="-5" y1="-25" x2="-5" y2="35" stroke="url(#goldGradient)" stroke-width="2"/>
    </g>
    <g transform="translate(130, 45)">
      <path d="M -20 10 L -12 0 L 0 -5 L 12 0 L 20 10 Z" fill="url(#goldGradient)" stroke="#AA8C1A" stroke-width="1.5"/>
      <circle cx="-12" cy="0" r="3" fill="#FFFFFF"/>
      <circle cx="0" cy="-5" r="3.5" fill="#FFFFFF"/>
      <circle cx="12" cy="0" r="3" fill="#FFFFFF"/>
    </g>
  </g>
  <g id="typography">
    <text x="230" y="110" font-family="Georgia, serif" font-size="72" font-weight="bold" fill="#1a1a1a" letter-spacing="-1">TRANSILVANIA</text>
    <text x="230" y="160" font-family="Georgia, serif" font-size="48" font-style="italic" fill="#C41E3A" letter-spacing="2">TIMES</text>
    <text x="230" y="195" font-family="Georgia, serif" font-size="16" fill="#666666" letter-spacing="1">News from the Heart of Transylvania</text>
    <line x1="230" y1="210" x2="750" y2="210" stroke="url(#goldGradient)" stroke-width="2"/>
  </g>
  <g opacity="0.03">
    <path d="M 50 250 Q 500 200 950 250" stroke="#1a1a1a" stroke-width="1" fill="none"/>
  </g>
</svg>
EOF
echo "✓ Horizontal logo created"

# Create stacked logo SVG
echo "🎨 Creating stacked logo..."
cat > "$LOGOS_DIR/transilvania-times-logo-stacked.svg" << 'EOF'
<svg viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="goldGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#D4AF37;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#AA8C1A;stop-opacity:1" />
    </linearGradient>
    <linearGradient id="redGradient" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" style="stop-color:#C41E3A;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#8B1428;stop-opacity:1" />
    </linearGradient>
    <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
      <feDropShadow dx="2" dy="2" stdDeviation="3" flood-opacity="0.2"/>
    </filter>
  </defs>
  <rect width="300" height="400" fill="#FFFFFF"/>
  <g id="mark" transform="translate(75, 40)" filter="url(#shadow)">
    <path d="M 0 0 L 0 60 Q 0 85 35 105 Q 70 85 70 60 L 70 0 Z" fill="url(#redGradient)" stroke="#8B1428" stroke-width="2"/>
    <g transform="translate(35, 35)">
      <path d="M -15 -12 L -5 -12 L -5 18 L -15 18 Z" fill="#FFFFFF" opacity="0.9"/>
      <path d="M 3 -12 L 15 -12 L 15 18 L 3 18 Z" fill="#FFFFFF" opacity="0.85"/>
      <line x1="-2" y1="-12" x2="-2" y2="18" stroke="url(#goldGradient)" stroke-width="1.5"/>
    </g>
    <g transform="translate(35, 15)">
      <path d="M -10 5 L -6 0 L 0 -2 L 6 0 L 10 5 Z" fill="url(#goldGradient)" stroke="#AA8C1A" stroke-width="1"/>
      <circle cx="-6" cy="0" r="2" fill="#FFFFFF"/>
      <circle cx="0" cy="-2" r="2" fill="#FFFFFF"/>
      <circle cx="6" cy="0" r="2" fill="#FFFFFF"/>
    </g>
  </g>
  <g id="typography">
    <text x="150" y="200" font-family="Georgia, serif" font-size="42" font-weight="bold" fill="#1a1a1a" text-anchor="middle" letter-spacing="-0.5">TRANSILVANIA</text>
    <text x="150" y="250" font-family="Georgia, serif" font-size="38" font-style="italic" fill="#C41E3A" text-anchor="middle" letter-spacing="1.5">TIMES</text>
    <line x1="50" y1="265" x2="250" y2="265" stroke="url(#goldGradient)" stroke-width="2"/>
    <text x="150" y="310" font-family="Georgia, serif" font-size="12" fill="#666666" text-anchor="middle" letter-spacing="0.5">News from the Heart of</text>
    <text x="150" y="330" font-family="Georgia, serif" font-size="12" fill="#666666" text-anchor="middle" letter-spacing="0.5">Transylvania</text>
  </g>
</svg>
EOF
echo "✓ Stacked logo created"

# Create favicon symbol SVG
echo "🎨 Creating favicon symbol..."
cat > "$LOGOS_DIR/transilvania-times-favicon-symbol.svg" << 'EOF'
<svg viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="goldGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#D4AF37;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#AA8C1A;stop-opacity:1" />
    </linearGradient>
    <linearGradient id="redGradient" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" style="stop-color:#C41E3A;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#8B1428;stop-opacity:1" />
    </linearGradient>
    <filter id="innerShadow" x="-50%" y="-50%" width="200%" height="200%">
      <feDropShadow dx="1" dy="1" stdDeviation="2" flood-opacity="0.15"/>
    </filter>
  </defs>
  <rect width="256" height="256" fill="#FFFFFF" rx="0"/>
  <g transform="translate(50, 35)">
    <path d="M 0 0 L 0 90 Q 0 130 55 160 Q 110 130 110 90 L 110 0 Z" fill="url(#redGradient)" stroke="#8B1428" stroke-width="3" filter="url(#innerShadow)"/>
    <path d="M 4 3 L 4 87 Q 4 124 55 152 Q 103 125 103 90 L 103 3 Z" fill="none" stroke="#FFFFFF" stroke-width="1" opacity="0.4"/>
    <g transform="translate(55, 50)">
      <path d="M -25 -20 L -8 -20 L -8 50 L -25 50 Z" fill="#FFFFFF" opacity="0.95"/>
      <path d="M 6 -20 L 25 -20 L 25 50 L 6 50 Z" fill="#FFFFFF" opacity="0.90"/>
      <path d="M -3 -20 L -3 50" stroke="url(#goldGradient)" stroke-width="2.5"/>
      <line x1="-20" y1="5" x2="-12" y2="5" stroke="#C41E3A" stroke-width="1.5" opacity="0.6"/>
      <line x1="-20" y1="15" x2="-12" y2="15" stroke="#C41E3A" stroke-width="1.5" opacity="0.6"/>
      <line x1="-20" y1="25" x2="-12" y2="25" stroke="#C41E3A" stroke-width="1.5" opacity="0.6"/>
      <line x1="11" y1="5" x2="19" y2="5" stroke="#C41E3A" stroke-width="1.5" opacity="0.6"/>
      <line x1="11" y1="15" x2="19" y2="15" stroke="#C41E3A" stroke-width="1.5" opacity="0.6"/>
      <line x1="11" y1="25" x2="19" y2="25" stroke="#C41E3A" stroke-width="1.5" opacity="0.6"/>
    </g>
    <g transform="translate(55, 18)">
      <path d="M -15 8 L -8 -2 L 0 -5 L 8 -2 L 15 8 Z" fill="url(#goldGradient)" stroke="#AA8C1A" stroke-width="1.5"/>
      <circle cx="-8" cy="-2" r="3" fill="#FFFFFF" opacity="0.8"/>
      <circle cx="0" cy="-5" r="3.5" fill="#FFFFFF" opacity="0.8"/>
      <circle cx="8" cy="-2" r="3" fill="#FFFFFF" opacity="0.8"/>
    </g>
  </g>
  <rect x="30" y="225" width="196" height="2" fill="url(#goldGradient)" opacity="0.6" rx="1"/>
</svg>
EOF
echo "✓ Favicon symbol created"

# Create favicon 32x32
echo "🎨 Creating favicon 32x32..."
cat > "$FAVICONS_DIR/favicon-32x32.svg" << 'EOF'
<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="redGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" style="stop-color:#C41E3A;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#8B1428;stop-opacity:1" />
    </linearGradient>
    <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#D4AF37;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#AA8C1A;stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="32" height="32" fill="#FFFFFF"/>
  <path d="M 6 5 L 6 14 Q 6 20 16 25 Q 26 20 26 14 L 26 5 Z" fill="url(#redGrad)" stroke="#8B1428" stroke-width="0.5"/>
  <rect x="10" y="9" width="3" height="10" fill="#FFFFFF" opacity="0.95"/>
  <rect x="15" y="9" width="3" height="10" fill="#FFFFFF" opacity="0.90"/>
  <line x1="13.5" y1="9" x2="13.5" y2="19" stroke="url(#goldGrad)" stroke-width="0.5"/>
  <path d="M 14 6 L 15 4 L 16 5 L 17 4 L 18 6 Z" fill="url(#goldGrad)" stroke="#AA8C1A" stroke-width="0.3"/>
</svg>
EOF
echo "✓ Favicon 32x32 created"

# Create a simple favicon.ico placeholder (pointing to 32x32)
echo "📝 Creating favicon.ico reference..."
cat > "$FAVICONS_DIR/favicon.ico.txt" << 'EOF'
# Note: This is a placeholder for favicon.ico
# To create a true .ico file, use one of these methods:

# Method 1: Online Converter (Easiest)
# 1. Go to https://convertio.co/svg-ico/
# 2. Upload favicon-32x32.svg
# 3. Download as favicon.ico

# Method 2: ImageMagick (if installed)
# convert favicon-32x32.svg favicon.ico

# Method 3: RealFaviconGenerator
# 1. Visit https://realfavicongenerator.net/
# 2. Upload favicon symbol SVG
# 3. Download generated favicon files

# For now, browsers will use the SVG directly or you can point to favicon-32x32.svg
EOF
echo "✓ Favicon reference created"

# Create HTML snippet file for easy copy-paste
echo "📝 Creating HTML integration snippet..."
cat > "$ASSETS_DIR/FAVICON_HTML_SNIPPET.html" << 'EOF'
<!-- Add these lines to your <head> section in index.html -->

<!-- Favicon -->
<link rel="icon" type="image/svg+xml" href="/public/assets/favicons/favicon-32x32.svg">
<link rel="icon" type="image/x-icon" href="/public/assets/favicons/favicon.ico">
<link rel="apple-touch-icon" href="/public/assets/logos/transilvania-times-favicon-symbol.svg">

<!-- Mobile Web App Meta Tags -->
<meta name="theme-color" content="#C41E3A">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Transilvania Times">

<!-- Open Graph (Social Media) -->
<meta property="og:image" content="/public/assets/logos/transilvania-times-favicon-symbol.svg">
<meta property="og:image:width" content="256">
<meta property="og:image:height" content="256">
<meta name="twitter:image" content="/public/assets/logos/transilvania-times-favicon-symbol.svg">
EOF
echo "✓ HTML snippet created"

# Create brand colors CSS file
echo "🎨 Creating brand colors CSS..."
cat > "$ASSETS_DIR/brand-colors.css" << 'EOF'
/* ============================================================
   TRANSILVANIA TIMES - BRAND COLOR SYSTEM
   ============================================================ */

:root {
  /* Primary Colors - Romanian Heritage */
  --brand-red-primary: #C41E3A;
  --brand-red-dark: #8B1428;
  --brand-red-light: #E63D52;
  
  /* Secondary Colors - Premium Accent */
  --brand-gold-primary: #D4AF37;
  --brand-gold-dark: #AA8C1A;
  --brand-gold-light: #E6C856;
  
  /* Neutral Colors */
  --brand-dark: #1a1a1a;
  --brand-gray: #666666;
  --brand-light-gray: #f5f5f5;
  --brand-white: #FFFFFF;
  
  /* Semantic Colors */
  --success: #2ecc71;
  --warning: #f39c12;
  --error: #e74c3c;
  --info: #3498db;
}

/* Logo Mark */
.logo-mark,
.logo-shield {
  color: var(--brand-red-primary);
  fill: var(--brand-red-primary);
}

/* Crown Accent */
.crown-accent,
.crown {
  color: var(--brand-gold-primary);
  fill: var(--brand-gold-primary);
}

/* Text Colors */
.text-primary {
  color: var(--brand-dark);
}

.text-accent {
  color: var(--brand-red-primary);
}

.text-secondary {
  color: var(--brand-gray);
}

/* Background Colors */
.bg-dark {
  background-color: var(--brand-dark);
}

.bg-light {
  background-color: var(--brand-light-gray);
}

.bg-red {
  background-color: var(--brand-red-primary);
}

.bg-gold {
  background-color: var(--brand-gold-primary);
}

/* Border Colors */
.border-red {
  border-color: var(--brand-red-primary);
}

.border-gold {
  border-color: var(--brand-gold-primary);
}

/* Gradient Classes */
.gradient-red-to-dark {
  background: linear-gradient(135deg, var(--brand-red-primary), var(--brand-red-dark));
}

.gradient-gold {
  background: linear-gradient(135deg, var(--brand-gold-primary), var(--brand-gold-dark));
}

/* Shadow Classes */
.shadow-subtle {
  box-shadow: 0 2px 8px rgba(196, 30, 58, 0.1);
}

.shadow-medium {
  box-shadow: 0 4px 12px rgba(196, 30, 58, 0.15);
}

.shadow-prominent {
  box-shadow: 0 8px 24px rgba(196, 30, 58, 0.2);
}
EOF
echo "✓ Brand colors CSS created"

# Create README for the assets directory
echo "📝 Creating assets README..."
cat > "$ASSETS_DIR/README.md" << 'EOF'
# 🎨 Transilvania Times - Brand Assets

This directory contains all official brand assets for the Transilvania Times news hub.

## Directory Structure

```
assets/
├── logos/                              # Logo files (SVG)
│   ├── transilvania-times-logo.svg           # Horizontal logo (1000x300)
│   ├── transilvania-times-logo-stacked.svg   # Vertical logo (300x400)
│   └── transilvania-times-favicon-symbol.svg # Icon/symbol (256x256)
├── favicons/                           # Favicon files
│   ├── favicon-32x32.svg                # 32x32 favicon
│   └── favicon.ico.txt                  # Instructions for ICO creation
├── brand-colors.css                    # CSS color variables and utilities
├── FAVICON_HTML_SNIPPET.html           # Copy-paste HTML for favicons
└── README.md                           # This file
```

## Quick Start

### 1. Add Favicon to HTML
Copy the contents of `FAVICON_HTML_SNIPPET.html` into your `<head>` section.

### 2. Use Logo in Website
```html
<!-- Horizontal -->
<img src="/public/assets/logos/transilvania-times-logo.svg" alt="Transilvania Times">

<!-- Vertical/Stacked -->
<img src="/public/assets/logos/transilvania-times-logo-stacked.svg" alt="Transilvania Times">

<!-- Icon/Symbol -->
<img src="/public/assets/logos/transilvania-times-favicon-symbol.svg" alt="Transilvania Times">
```

### 3. Use Brand Colors in CSS
```css
@import '/public/assets/brand-colors.css';

.primary {
  color: var(--brand-red-primary);
}

.accent {
  color: var(--brand-gold-primary);
}
```

## Brand Colors

### Primary (Red)
- `#C41E3A` - Main brand red
- `#8B1428` - Dark red
- `#E63D52` - Light red

### Secondary (Gold)
- `#D4AF37` - Main brand gold
- `#AA8C1A` - Dark gold
- `#E6C856` - Light gold

### Neutral
- `#1a1a1a` - Dark
- `#666666` - Gray
- `#f5f5f5` - Light gray
- `#FFFFFF` - White

## Using SVG Files

All SVG files are scalable and can be used at any size:

```html
<!-- As image -->
<img src="path/to/logo.svg" width="200" alt="Logo">

<!-- As background -->
<div style="background-image: url('path/to/logo.svg')"></div>

<!-- In CSS -->
.logo { background-image: url('path/to/logo.svg'); }
```

## Creating favicon.ico

To convert the SVG favicon to .ico format:

**Option 1: Online (Easiest)**
1. Visit https://convertio.co/svg-ico/
2. Upload `favicons/favicon-32x32.svg`
3. Download as `favicon.ico`
4. Place in `favicons/` directory

**Option 2: Command Line (ImageMagick)**
```bash
convert public/assets/favicons/favicon-32x32.svg public/assets/favicons/favicon.ico
```

**Option 3: RealFaviconGenerator**
1. Go to https://realfavicongenerator.net/
2. Upload any logo SVG
3. Customize and download all formats
4. Extract to `favicons/` directory

## Social Media Usage

### Twitter/X
- Avatar: `logos/transilvania-times-favicon-symbol.svg` (256x256)
- Header: `logos/transilvania-times-logo.svg` scaled to 1500x500

### Facebook
- Profile: `logos/transilvania-times-favicon-symbol.svg`
- Cover: `logos/transilvania-times-logo.svg` scaled to 1200x630

### Instagram
- Avatar: `logos/transilvania-times-favicon-symbol.svg` (square)
- Stories: `logos/transilvania-times-logo-stacked.svg` (vertical)

### LinkedIn
- Logo: `logos/transilvania-times-logo.svg` (300x100 recommended)

## Brand Guidelines

✅ **DO:**
- Scale SVG files proportionally
- Use on contrasting backgrounds
- Maintain clear space around logo (20% of logo height)
- Use full color versions on white/light backgrounds

❌ **DON'T:**
- Change colors
- Distort or rotate
- Add overlays
- Use on dark backgrounds without adjustment
- Rasterize unnecessarily

## Support

For questions or modifications to brand assets, contact the development team.

---

**Version**: 1.0  
**Created**: March 22, 2026  
**Brand**: Transilvania Times News Hub
EOF
echo "✓ Assets README created"

echo ""
echo "======================================================================"
echo "✅ Brand Assets Setup Complete!"
echo "======================================================================"
echo ""
echo "📁 Created files:"
echo "   📂 $LOGOS_DIR/"
echo "      • transilvania-times-logo.svg"
echo "      • transilvania-times-logo-stacked.svg"
echo "      • transilvania-times-favicon-symbol.svg"
echo ""
echo "   📂 $FAVICONS_DIR/"
echo "      • favicon-32x32.svg"
echo "      • favicon.ico.txt (instructions)"
echo ""
echo "   📄 $ASSETS_DIR/"
echo "      • brand-colors.css"
echo "      • FAVICON_HTML_SNIPPET.html"
echo "      • README.md"
echo ""
echo "📋 Next Steps:"
echo ""
echo "1. Copy HTML snippet to your index.html <head>:"
echo "   cat $ASSETS_DIR/FAVICON_HTML_SNIPPET.html"
echo ""
echo "2. Create favicon.ico (see instructions in $FAVICONS_DIR/favicon.ico.txt)"
echo ""
echo "3. Import brand colors in your CSS:"
echo "   @import '/public/assets/brand-colors.css';"
echo ""
echo "4. Commit to Git:"
echo "   git add public/assets/"
echo "   git commit -m 'Add professional brand assets: logos and favicons'"
echo "   git push origin main"
echo ""
echo "5. Test favicons (clear browser cache):"
echo "   Ctrl+Shift+Delete (Windows/Linux) or Cmd+Shift+Delete (Mac)"
echo ""
echo "======================================================================"
echo "🎉 Your brand assets are ready!"
echo "======================================================================"
EOF
