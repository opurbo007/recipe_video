import { useState, useEffect, useCallback } from 'react';
import data from '../data/recipes.json';

export default function HeaderSlider() {
  const slides = data.sliderImages;
  const [current, setCurrent] = useState(0);

  const next = useCallback(() => {
    setCurrent(prev => (prev + 1) % slides.length);
  }, [slides.length]);

  const prev = () => setCurrent(prev => (prev - 1 + slides.length) % slides.length);

  useEffect(() => {
    const timer = setInterval(next, 5000);
    return () => clearInterval(timer);
  }, [next]);

  return (
    <div className="slider">
      <div className="slider__track" style={{ transform: `translateX(-${current * 100}%)` }}>
        {slides.map((slide, i) => (
          <div className="slide" key={i}>
            <img src={slide.url} alt={slide.title} className="slide__img" />
            <div className="slide__overlay">
              <div className="slide__content">
                <h1 className="slide__title">{slide.title}</h1>
                <p className="slide__subtitle">{slide.subtitle}</p>
                <a href="#categories" className="btn btn-primary btn-lg">
                  Explore Recipes 
                </a>
              </div>
            </div>
          </div>
        ))}
      </div>

      <button className="slider__arrow slider__arrow--prev" onClick={prev} aria-label="Previous">‹</button>
      <button className="slider__arrow slider__arrow--next" onClick={next} aria-label="Next">›</button>

      <div className="slider__controls">
        {slides.map((_, i) => (
          <button
            key={i}
            className={`slider__dot ${i === current ? 'active' : ''}`}
            onClick={() => setCurrent(i)}
            aria-label={`Go to slide ${i + 1}`}
          />
        ))}
      </div>
    </div>
  );
}
