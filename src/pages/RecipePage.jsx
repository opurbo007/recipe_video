import { useParams, Link, useNavigate } from 'react-router-dom';
import data from '../data/recipes.json';

function generateRoomId() {
  return Math.random().toString(36).substring(2, 10);
}

export default function RecipePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const recipe = data.recipes.find(r => r.id === id);
  const category = recipe ? data.categories.find(c => c.id === recipe.categoryId) : null;

  if (!recipe) {
    return (
      <div className="container">
        <div className="empty-state" style={{ paddingTop: 120 }}>
          <div className="empty-state__icon">🍽️</div>
          <h3>Recipe not found</h3>
          <Link to="/" className="btn btn-primary" style={{ marginTop: '20px' }}>← Back Home</Link>
        </div>
      </div>
    );
  }

  const handleMakeWithFriend = () => {
    const roomId = generateRoomId();
    // Encode recipeId in the URL so the friend gets it too via the invite link
    navigate(`/room/${roomId}?recipe=${recipe.id}`);
  };

  return (
    <main className="recipe-page">
      {/* Hero */}
      <div className="recipe-page__hero">
        <img src={recipe.image} alt={recipe.title} />
        <div className="recipe-page__hero-content">
          {category && (
            <Link to={`/category/${category.id}`} className="recipe-page__hero-back">
              ← {category.name}
            </Link>
          )}
          <span className="recipe-page__category-tag">{category?.name}</span>
          <h1 className="recipe-page__title">{recipe.title}</h1>
          <div className="recipe-page__stats">
            <div className="recipe-page__stat">
              <span className="recipe-page__stat-value">{recipe.time}</span>
              <span className="recipe-page__stat-label">Total Time</span>
            </div>
            <div className="recipe-page__stat">
              <span className="recipe-page__stat-value">{recipe.servings}</span>
              <span className="recipe-page__stat-label">Servings</span>
            </div>
            <div className="recipe-page__stat">
              <span className="recipe-page__stat-value">{recipe.difficulty}</span>
              <span className="recipe-page__stat-label">Difficulty</span>
            </div>
            <div className="recipe-page__stat">
              <span className="recipe-page__stat-value">{recipe.ingredients.length}</span>
              <span className="recipe-page__stat-label">Ingredients</span>
            </div>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="recipe-page__body">
        {/* Ingredients */}
        <div>
          <h2 className="recipe-section-title">Ingredients</h2>
          <ul className="ingredients-list">
            {recipe.ingredients.map((item, i) => (
              <li key={i} className="ingredient-item">{item}</li>
            ))}
          </ul>
        </div>

        {/* Instructions */}
        <div>
          <h2 className="recipe-section-title">Instructions</h2>
          <ol className="instructions-list">
            {recipe.instructions.map((step, i) => (
              <li key={i} className="instruction-step">
                <span className="step-number">{i + 1}</span>
                <p className="step-text">{step}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>

      {/* Make With Friend CTA */}
      <div className="friend-cta">
        <h3>Cook this together? 🍳</h3>
        <p>Invite a friend to a live video call and make this recipe side-by-side.</p>
        <button
          className="btn btn-primary btn-lg"
          onClick={handleMakeWithFriend}
        >
          🎥 Make With Friend
        </button>
      </div>
    </main>
  );
}
