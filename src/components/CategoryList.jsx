import { Link } from 'react-router-dom';
import data from '../data/recipes.json';

export default function CategoryList() {
  const { categories } = data;

  return (
    <section className="categories-section" id="categories">
      <div className="container">
        <div className="section-header">
          <h2>What are you craving?</h2>
          <p>Browse our curated collection of recipes by category</p>
          <div className="section-header__line" />
        </div>
        <div className="categories-grid">
          {categories.map(cat => (
            <Link to={`/category/${cat.id}`} key={cat.id} className="category-card">
              <div className="category-card__img-wrap">
                <img src={cat.image} alt={cat.name} />
              </div>
              <div className="category-card__body">
                <div className="category-card__emoji">{cat.emoji}</div>
                <div className="category-card__name">{cat.name}</div>
                <div className="category-card__desc">{cat.description}</div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
