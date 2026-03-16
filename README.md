# 🍳 me&u — Recipe & Cook Together

A minimal, beautifully designed recipe website with live video calling so you can cook with friends in real time.

---

## ✨ Features

- **Home Page** — animated hero image slider + clickable recipe categories
- **Category Page** — recipe cards filtered by category
- **Recipe Page** — full recipe detail with ingredients & step-by-step instructions
- **Video Call Room** — WebRTC peer-to-peer video using PeerJS, with invite link sharing

---

## 🛠 Tech Stack

| Tool            | Purpose                     |
| --------------- | --------------------------- |
| React 18 + Vite | UI & bundler                |
| React Router v6 | Client-side routing         |
| PeerJS          | WebRTC video calling        |
| Plain CSS       | All styling — no frameworks |
| Local JSON      | Recipe data — no backend    |

---

## 📁 Project Structure

```
src/
  components/
    HeaderSlider.jsx      ← Auto-advancing image slider
    CategoryList.jsx      ← Category grid on home page
    RecipeCard.jsx        ← Recipe card with "View Recipe" button
  pages/
    Home.jsx              ← Slider + Categories
    CategoryPage.jsx      ← Recipes filtered by category
    RecipePage.jsx        ← Full recipe + "Make With Friend" button
    Room.jsx              ← PeerJS video call room
  data/
    recipes.json          ← All recipe & category data
  styles/
    main.css              ← All CSS styles
  App.jsx                 ← Router setup + layout
  main.jsx                ← Entry point
index.html
package.json
vite.config.js
```

---

## 🚀 Installation & Setup

### 1. Clone or download this project

```bash
git clone <your-repo-url>
cd me&u-recipe-app
```

### 2. Install dependencies

```bash
npm install
```

This installs: `react`, `react-dom`, `react-router-dom`, and `peerjs`.

### 3. Start the development server

```bash
npm run dev
```

Open your browser at **http://localhost:5173**

---

## 📞 How Video Calling Works

me&u uses **PeerJS** (WebRTC) for peer-to-peer video calls — no server required.

### Flow:

1. User opens a recipe and clicks **"Make With Friend"**
2. A random **room ID** is generated and the user navigates to `/room/:id`
3. The app requests camera + mic access
4. The first person to join becomes the **host** (claimed peer ID: `recipetogether-host-<roomId>`)
5. The second person clicks **"Copy Invite Link"** and sends it to their friend
6. When the friend opens the link, they join as a **guest** and automatically call the host
7. Live video appears for both users

### To test locally:

1. Open the app in **two different browser windows** (or different browsers)
2. In window 1: go to any recipe → click **"Make With Friend"**
3. Copy the invite URL from the room page
4. Paste it in window 2 — video should connect within a few seconds

---

## 🎨 Design Choices

- **Font**: Playfair Display (headings) + DM Sans (body)
- **Primary colour**: `#F93481` (hot pink)
- **Aesthetic**: Warm, editorial food-magazine style
- **Base background**: White
- **Animations**: CSS transitions & keyframes only

---

## 📦 Build for Production

```bash
npm run build
```

Output goes to the `dist/` folder — ready for static hosting (Vercel, Netlify, GitHub Pages, etc.).

---

## 🔧 Customising Recipes

Edit `src/data/recipes.json` to add/change:

- `categories` — add new food categories
- `recipes` — add new recipes with ingredients, instructions, images
- `sliderImages` — change the hero slider images

All images use Unsplash URLs — replace with your own hosted images for production.

---

## ⚠️ Notes

- PeerJS uses Google's public STUN servers — works on most networks
- Video calling requires **HTTPS** in production (works on `localhost` during development)
- Make sure to allow camera & microphone permissions in the browser

---

_Built with React + Vite + PeerJS. No backend. No database. No auth._
