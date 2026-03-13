import { Link } from 'react-router-dom';

export default function RecipeCard({ recipe }) {
  return (
    <div className="recipe-card">
      <div className="recipe-card__img-wrap">
        <img src={recipe.image} alt={recipe.title} />
        <span className="recipe-card__badge">{recipe.difficulty}</span>
      </div>
      <div className="recipe-card__body">
        <div className="recipe-card__meta">
          <span>⏱ {recipe.time}</span>
          <span>👤 {recipe.servings} servings</span>
        </div>
        <h3 className="recipe-card__title">{recipe.title}</h3>
        <Link to={`/recipe/${recipe.id}`} className="btn btn-primary btn-full">
          View Recipe
        </Link>
      </div>
    </div>
  );
}
