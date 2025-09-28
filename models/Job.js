const mongoose = require('mongoose');

const jobSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true
  },
  company: {
    name: {
      type: String,
      required: true,
      trim: true
    },
    logo: String,
    website: String,
    size: {
      type: String,
      enum: ['startup', 'small', 'medium', 'large', 'enterprise']
    },
    industry: String,
    location: {
      city: String,
      state: String,
      country: String,
      isRemote: {
        type: Boolean,
        default: false
      }
    }
  },
  type: {
    type: String,
    enum: ['internship', 'full-time', 'part-time', 'contract', 'freelance'],
    required: true
  },
  category: {
    type: String,
    enum: ['software', 'data-science', 'design', 'marketing', 'finance', 'operations', 'other'],
    required: true
  },
  requirements: {
    skills: [String],
    experience: {
      min: Number,
      max: Number
    },
    education: {
      degree: String,
      field: String,
      minimumCGPA: Number
    },
    departments: [String],
    year: [Number]
  },
  compensation: {
    stipend: {
      min: Number,
      max: Number,
      currency: {
        type: String,
        default: 'INR'
      }
    },
    benefits: [String],
    perks: [String]
  },
  duration: {
    startDate: Date,
    endDate: Date,
    isFlexible: {
      type: Boolean,
      default: false
    }
  },
  application: {
    deadline: Date,
    maxApplications: Number,
    currentApplications: {
      type: Number,
      default: 0
    },
    requirements: {
      resume: {
        type: Boolean,
        default: true
      },
      coverLetter: {
        type: Boolean,
        default: false
      },
      portfolio: {
        type: Boolean,
        default: false
      },
      additionalDocuments: [String]
    }
  },
  status: {
    type: String,
    enum: ['draft', 'active', 'paused', 'closed', 'expired'],
    default: 'draft'
  },
  visibility: {
    type: String,
    enum: ['public', 'department-specific', 'private'],
    default: 'public'
  },
  tags: [String],
  postedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approvedAt: Date,
  // Analytics
  analytics: {
    views: {
      type: Number,
      default: 0
    },
    applications: {
      type: Number,
      default: 0
    },
    shortlisted: {
      type: Number,
      default: 0
    },
    hired: {
      type: Number,
      default: 0
    }
  },
  // Placement conversion probability
  conversionProbability: {
    type: Number,
    min: 0,
    max: 100,
    default: 50
  },
  // Interview process
  interviewProcess: {
    rounds: [{
      name: String,
      type: {
        type: String,
        enum: ['online', 'offline', 'phone', 'video']
      },
      duration: Number,
      description: String
    }],
    totalRounds: Number,
    estimatedDuration: Number
  },
  // Feedback from previous placements
  feedback: {
    rating: {
      type: Number,
      min: 1,
      max: 5
    },
    comments: String,
    wouldRecommend: Boolean
  }
}, {
  timestamps: true
});

// Indexes
jobSchema.index({ title: 'text', description: 'text' });
jobSchema.index({ 'company.name': 1 });
jobSchema.index({ type: 1 });
jobSchema.index({ category: 1 });
jobSchema.index({ status: 1 });
jobSchema.index({ 'application.deadline': 1 });
jobSchema.index({ postedBy: 1 });
jobSchema.index({ tags: 1 });

// Virtual for application status
jobSchema.virtual('isOpen').get(function() {
  const now = new Date();
  return this.status === 'active' && 
         this.application.deadline > now && 
         this.application.currentApplications < this.application.maxApplications;
});

// Virtual for days until deadline
jobSchema.virtual('daysUntilDeadline').get(function() {
  const now = new Date();
  const deadline = new Date(this.application.deadline);
  const diffTime = deadline - now;
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
});

// Pre-save middleware to update analytics
jobSchema.pre('save', function(next) {
  if (this.isModified('application.currentApplications')) {
    this.analytics.applications = this.application.currentApplications;
  }
  next();
});

// Method to increment views
jobSchema.methods.incrementViews = function() {
  this.analytics.views += 1;
  return this.save();
};

// Method to check if user can apply
jobSchema.methods.canApply = function(userId) {
  // Check if job is open
  if (!this.isOpen) return false;
  
  // Check if user has already applied (this would need to be checked with Application model)
  // This is a simplified check
  return true;
};

// Static method to find active jobs
jobSchema.statics.findActive = function() {
  return this.find({ 
    status: 'active',
    'application.deadline': { $gt: new Date() }
  });
};

// Static method to find jobs by company
jobSchema.statics.findByCompany = function(companyName) {
  return this.find({ 'company.name': new RegExp(companyName, 'i') });
};

// Static method to search jobs
jobSchema.statics.search = function(query, filters = {}) {
  const searchQuery = {
    $text: { $search: query },
    ...filters
  };
  
  return this.find(searchQuery, { score: { $meta: 'textScore' } })
    .sort({ score: { $meta: 'textScore' } });
};

module.exports = mongoose.model('Job', jobSchema);
