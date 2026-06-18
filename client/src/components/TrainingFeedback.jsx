import React, { useState } from 'react';
import axios from 'axios';
import { Star, Loader2, CheckCircle } from 'lucide-react';

function TrainingFeedback({ sessionId, lessonId, onComplete }) {
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [feedbackText, setFeedbackText] = useState('');
  const [engagementRating, setEngagementRating] = useState('');
  const [understandingRating, setUnderstandingRating] = useState('');
  const [recommendation, setRecommendation] = useState('');
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showToast, setShowToast] = useState(false);

  const handleStarClick = (value) => {
    setRating(value);
    if (error && value > 0) setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Validation
    if (rating === 0) {
      setError('Please select a star rating to rate your training experience.');
      return;
    }
    if (!engagementRating) {
      setError('Please answer: "How engaging was the AI instructor?"');
      return;
    }
    if (!understandingRating) {
      setError('Please answer: "How well did you understand the concepts taught?"');
      return;
    }
    if (!recommendation) {
      setError('Please answer: "Would you recommend this training to other sales representatives?"');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await axios.post('/api/feedback', {
        sessionId,
        lessonId,
        rating,
        feedbackText,
        engagementRating,
        understandingRating,
        recommendation
      });
      
      setShowToast(true);
      setTimeout(() => {
        onComplete();
      }, 2000);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to submit feedback. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className="feedback-overlay animate-fade">
      {showToast && (
        <div className="toast-notification">
          <CheckCircle style={{ width: '18px', height: '18px' }} />
          <span>Thank you for your feedback.</span>
        </div>
      )}

      <div className="glass-panel feedback-card">
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <h1 className="feedback-heading">Training Session Completed</h1>
          <p className="feedback-subheading">Your feedback helps us improve future training sessions.</p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          {/* Star Rating */}
          <div className="feedback-section">
            <label className="feedback-label">Rate your training experience</label>
            <div className="stars-container">
              {[1, 2, 3, 4, 5].map((starValue) => {
                const isHighlighted = hoverRating >= starValue || (!hoverRating && rating >= starValue);
                return (
                  <button
                    key={starValue}
                    type="button"
                    className="star-btn"
                    onClick={() => handleStarClick(starValue)}
                    onMouseEnter={() => setHoverRating(starValue)}
                    onMouseLeave={() => setHoverRating(0)}
                    aria-label={`Rate ${starValue} stars`}
                  >
                    <Star
                      style={{
                        width: '32px',
                        height: '32px',
                        fill: isHighlighted ? 'var(--accent-warning)' : 'none',
                        stroke: isHighlighted ? 'var(--accent-warning)' : 'var(--color-text-muted)',
                        transition: 'var(--transition-smooth)'
                      }}
                    />
                  </button>
                );
              })}
            </div>
          </div>

          {/* Feedback Text Area */}
          <div className="feedback-section">
            <label className="feedback-label">Share your feedback</label>
            <textarea
              className="feedback-textarea"
              placeholder="What did you like? What can be improved?"
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value.slice(0, 500))}
              maxLength={500}
            />
            <span className="char-counter">
              {feedbackText.length} / 500
            </span>
          </div>

          {/* Question 1 */}
          <div className="feedback-section">
            <label className="feedback-label">How engaging was the AI instructor?</label>
            <div className="question-group">
              {['Excellent', 'Good', 'Average', 'Poor'].map((opt) => (
                <button
                  key={opt}
                  type="button"
                  className={`question-option ${engagementRating === opt ? 'selected' : ''}`}
                  onClick={() => setEngagementRating(opt)}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>

          {/* Question 2 */}
          <div className="feedback-section">
            <label className="feedback-label">How well did you understand the concepts taught?</label>
            <div className="question-group">
              {['Very Well', 'Well', 'Somewhat', 'Not Well'].map((opt) => (
                <button
                  key={opt}
                  type="button"
                  className={`question-option ${understandingRating === opt ? 'selected' : ''}`}
                  onClick={() => setUnderstandingRating(opt)}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>

          {/* Question 3 */}
          <div className="feedback-section">
            <label className="feedback-label">Would you recommend this training to other sales representatives?</label>
            <div className="question-group">
              {['Yes', 'Maybe', 'No'].map((opt) => (
                <button
                  key={opt}
                  type="button"
                  className={`question-option ${recommendation === opt ? 'selected' : ''}`}
                  onClick={() => setRecommendation(opt)}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div style={{ color: 'var(--accent-error)', fontSize: '0.9rem', fontWeight: '500', marginTop: '4px' }}>
              {error}
            </div>
          )}

          {/* Action Buttons */}
          <div className="feedback-actions">
            <button
              type="button"
              className="btn-skip"
              onClick={onComplete}
              disabled={loading}
            >
              Skip
            </button>
            <button
              type="submit"
              className="btn-submit"
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="animate-spin" style={{ width: '18px', height: '18px' }} />
                  Submitting...
                </>
              ) : (
                'Submit Feedback'
              )}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}

export default TrainingFeedback;
