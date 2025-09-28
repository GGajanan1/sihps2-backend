const mongoose = require('mongoose');

const feedbackSchema = new mongoose.Schema({
  application: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Application',
    required: true
  },
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  employer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  job: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Job',
    required: true
  },
  type: {
    type: String,
    enum: ['employer-to-student', 'student-to-employer', 'faculty-to-student', 'student-to-faculty'],
    required: true
  },
  rating: {
    overall: {
      type: Number,
      min: 1,
      max: 5,
      required: true
    },
    technical: {
      type: Number,
      min: 1,
      max: 5
    },
    communication: {
      type: Number,
      min: 1,
      max: 5
    },
    punctuality: {
      type: Number,
      min: 1,
      max: 5
    },
    teamwork: {
      type: Number,
      min: 1,
      max: 5
    },
    problemSolving: {
      type: Number,
      min: 1,
      max: 5
    }
  },
  comments: {
    type: String,
    required: true,
    maxlength: 1000
  },
  strengths: [String],
  areasForImprovement: [String],
  wouldRecommend: {
    type: Boolean,
    default: true
  },
  wouldHireAgain: {
    type: Boolean,
    default: true
  },
  isAnonymous: {
    type: Boolean,
    default: false
  },
  isPublic: {
    type: Boolean,
    default: false
  },
  // Specific feedback categories
  categories: {
    workQuality: {
      rating: Number,
      comments: String
    },
    attitude: {
      rating: Number,
      comments: String
    },
    learning: {
      rating: Number,
      comments: String
    },
    initiative: {
      rating: Number,
      comments: String
    }
  },
  // Additional structured feedback
  structuredFeedback: {
    technicalSkills: {
      rating: Number,
      comments: String
    },
    softSkills: {
      rating: Number,
      comments: String
    },
    workEthic: {
      rating: Number,
      comments: String
    },
    adaptability: {
      rating: Number,
      comments: String
    }
  },
  // Feedback metadata
  submittedAt: {
    type: Date,
    default: Date.now
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  verifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  verifiedAt: Date,
  // Response to feedback
  response: {
    from: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    message: String,
    submittedAt: Date
  }
}, {
  timestamps: true
});

// Indexes
feedbackSchema.index({ application: 1 });
feedbackSchema.index({ student: 1 });
feedbackSchema.index({ employer: 1 });
feedbackSchema.index({ type: 1 });
feedbackSchema.index({ 'rating.overall': 1 });
feedbackSchema.index({ submittedAt: -1 });
feedbackSchema.index({ isPublic: 1 });

// Virtual for average rating
feedbackSchema.virtual('averageRating').get(function() {
  const ratings = [
    this.rating.technical,
    this.rating.communication,
    this.rating.punctuality,
    this.rating.teamwork,
    this.rating.problemSolving
  ].filter(rating => rating !== undefined);
  
  if (ratings.length === 0) return this.rating.overall;
  
  const sum = ratings.reduce((acc, rating) => acc + rating, 0);
  return Math.round((sum / ratings.length) * 10) / 10;
});

// Method to calculate feedback score
feedbackSchema.methods.calculateScore = function() {
  const weights = {
    overall: 0.3,
    technical: 0.2,
    communication: 0.15,
    punctuality: 0.15,
    teamwork: 0.1,
    problemSolving: 0.1
  };
  
  let score = 0;
  let totalWeight = 0;
  
  Object.keys(weights).forEach(key => {
    if (this.rating[key] !== undefined) {
      score += this.rating[key] * weights[key];
      totalWeight += weights[key];
    }
  });
  
  return totalWeight > 0 ? Math.round((score / totalWeight) * 10) / 10 : 0;
};

// Static method to find by student
feedbackSchema.statics.findByStudent = function(studentId) {
  return this.find({ student: studentId })
    .populate('employer', 'firstName lastName employerInfo')
    .populate('job', 'title company')
    .sort({ submittedAt: -1 });
};

// Static method to find by employer
feedbackSchema.statics.findByEmployer = function(employerId) {
  return this.find({ employer: employerId })
    .populate('student', 'firstName lastName studentInfo')
    .populate('job', 'title company')
    .sort({ submittedAt: -1 });
};

// Static method to get average rating for student
feedbackSchema.statics.getAverageRatingForStudent = function(studentId) {
  return this.aggregate([
    { $match: { student: mongoose.Types.ObjectId(studentId) } },
    {
      $group: {
        _id: null,
        averageRating: { $avg: '$rating.overall' },
        totalFeedbacks: { $sum: 1 },
        ratings: { $push: '$rating.overall' }
      }
    }
  ]);
};

// Static method to get feedback statistics
feedbackSchema.statics.getStatistics = function(filters = {}) {
  return this.aggregate([
    { $match: filters },
    {
      $group: {
        _id: null,
        totalFeedbacks: { $sum: 1 },
        averageRating: { $avg: '$rating.overall' },
        highRatings: {
          $sum: {
            $cond: [{ $gte: ['$rating.overall', 4] }, 1, 0]
          }
        },
        lowRatings: {
          $sum: {
            $cond: [{ $lte: ['$rating.overall', 2] }, 1, 0]
          }
        }
      }
    }
  ]);
};

// Static method to find public feedback
feedbackSchema.statics.findPublic = function() {
  return this.find({ isPublic: true })
    .populate('student', 'firstName lastName studentInfo')
    .populate('employer', 'firstName lastName employerInfo')
    .populate('job', 'title company')
    .sort({ submittedAt: -1 });
};

module.exports = mongoose.model('Feedback', feedbackSchema);
