import { useParams, Link } from 'react-router-dom';
import RecipeCard from '../components/RecipeCard';
import data from '../data/recipes.json';

export default function CategoryPage() {
  const { id } = useParams();
  const category = data.categories.find(c => c.id === id);
  const recipes = data.recipes.filter(r => r.categoryId === id);

  if (!category) {
    return (
      <div className="container">
        <div className="empty-state" style={{ paddingTop: 120 }}>
          <div className="empty-state__icon">🍽️</div>
          <h3>Category not found</h3>
          <p>Let's get you back on track.</p>
          <br />
          <Link to="/" className="btn btn-primary">← Back Home</Link>
        </div>
      </div>
    );
  }

  return (
    <main className="recipes-section">
      <div className="page-header">
        <div className="container">
          <Link to="/" className="page-header__back">← All Categories</Link>
          <div style={{ fontSize: '3rem', marginBottom: '12px' }}>{category.emoji}</div>
          <h1>{category.name}</h1>
          <p style={{ color: 'var(--warm-gray)', marginTop: '10px' }}>
            {recipes.length} recipe{recipes.length !== 1 ? 's' : ''} in this collection
          </p>
        </div>
      </div>

      <div className="container">
        {recipes.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state__icon">🥺</div>
            <h3>No recipes here yet</h3>
            <p>We're working on adding more. Check back soon!</p>
          </div>
        ) : (
          <div className="recipes-grid">
            {recipes.map(recipe => (
              <RecipeCard key={recipe.id} recipe={recipe} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
