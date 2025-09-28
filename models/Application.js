const mongoose = require('mongoose');

const applicationSchema = new mongoose.Schema({
  job: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Job',
    required: true
  },
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  status: {
    type: String,
    enum: ['applied', 'under-review', 'shortlisted', 'rejected', 'interview-scheduled', 'interview-completed', 'offer-extended', 'offer-accepted', 'offer-declined', 'completed'],
    default: 'applied'
  },
  applicationData: {
    resume: String,
    coverLetter: String,
    portfolio: String,
    additionalDocuments: [{
      name: String,
      url: String,
      type: String
    }],
    customAnswers: [{
      question: String,
      answer: String
    }]
  },
  // Faculty approval workflow
  facultyApproval: {
    required: {
      type: Boolean,
      default: true
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending'
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    approvedAt: Date,
    comments: String,
    rejectionReason: String
  },
  // Interview details
  interview: {
    scheduled: {
      type: Boolean,
      default: false
    },
    date: Date,
    time: String,
    location: String,
    type: {
      type: String,
      enum: ['online', 'offline', 'phone', 'video']
    },
    meetingLink: String,
    interviewer: {
      name: String,
      email: String,
      phone: String
    },
    round: {
      type: Number,
      default: 1
    },
    feedback: {
      rating: Number,
      comments: String,
      strengths: [String],
      areasForImprovement: [String]
    },
    result: {
      type: String,
      enum: ['passed', 'failed', 'pending']
    }
  },
  // Offer details
  offer: {
    extended: {
      type: Boolean,
      default: false
    },
    extendedAt: Date,
    package: {
      stipend: Number,
      currency: String,
      benefits: [String]
    },
    startDate: Date,
    endDate: Date,
    terms: String,
    accepted: {
      type: Boolean,
      default: false
    },
    acceptedAt: Date,
    declinedAt: Date,
    declineReason: String
  },
  // Feedback and evaluation
  feedback: {
    fromEmployer: {
      rating: Number,
      comments: String,
      wouldHireAgain: Boolean,
      submittedAt: Date
    },
    fromStudent: {
      rating: Number,
      comments: String,
      experience: String,
      submittedAt: Date
    },
    fromFaculty: {
      rating: Number,
      comments: String,
      submittedAt: Date
    }
  },
  // Timeline tracking
  timeline: [{
    status: String,
    timestamp: Date,
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    comments: String
  }],
  // Communication
  messages: [{
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    message: {
      type: String,
      required: true
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    isRead: {
      type: Boolean,
      default: false
    }
  }],
  // Analytics
  analytics: {
    viewCount: {
      type: Number,
      default: 0
    },
    lastViewed: Date,
    responseTime: Number // Time taken to respond to application
  }
}, {
  timestamps: true
});

// Indexes
applicationSchema.index({ job: 1, student: 1 }, { unique: true });
applicationSchema.index({ student: 1 });
applicationSchema.index({ status: 1 });
applicationSchema.index({ 'facultyApproval.status': 1 });
applicationSchema.index({ 'interview.date': 1 });
applicationSchema.index({ createdAt: -1 });

// Virtual for application age
applicationSchema.virtual('ageInDays').get(function() {
  const now = new Date();
  const created = new Date(this.createdAt);
  const diffTime = now - created;
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
});

// Virtual for is overdue
applicationSchema.virtual('isOverdue').get(function() {
  const maxDays = 7; // Maximum days for review
  return this.ageInDays > maxDays && this.status === 'applied';
});

// Pre-save middleware to update timeline
applicationSchema.pre('save', function(next) {
  if (this.isModified('status')) {
    this.timeline.push({
      status: this.status,
      timestamp: new Date(),
      updatedBy: this.student // This should be updated based on who made the change
    });
  }
  next();
});

// Method to update status
applicationSchema.methods.updateStatus = function(newStatus, updatedBy, comments = '') {
  this.status = newStatus;
  this.timeline.push({
    status: newStatus,
    timestamp: new Date(),
    updatedBy: updatedBy,
    comments: comments
  });
  return this.save();
};

// Method to add message
applicationSchema.methods.addMessage = function(senderId, message) {
  this.messages.push({
    sender: senderId,
    message: message,
    timestamp: new Date()
  });
  return this.save();
};

// Method to mark messages as read
applicationSchema.methods.markMessagesAsRead = function(userId) {
  this.messages.forEach(message => {
    if (message.sender.toString() !== userId.toString()) {
      message.isRead = true;
    }
  });
  return this.save();
};

// Method to get unread message count
applicationSchema.methods.getUnreadMessageCount = function(userId) {
  return this.messages.filter(message => 
    message.sender.toString() !== userId.toString() && !message.isRead
  ).length;
};

// Static method to find by student
applicationSchema.statics.findByStudent = function(studentId) {
  return this.find({ student: studentId })
    .populate('job', 'title company type status')
    .sort({ createdAt: -1 });
};

// Static method to find by job
applicationSchema.statics.findByJob = function(jobId) {
  return this.find({ job: jobId })
    .populate('student', 'firstName lastName email studentInfo')
    .sort({ createdAt: -1 });
};

// Static method to find pending faculty approvals
applicationSchema.statics.findPendingFacultyApprovals = function() {
  return this.find({ 
    'facultyApproval.status': 'pending',
    'facultyApproval.required': true
  })
  .populate('job', 'title company')
  .populate('student', 'firstName lastName email studentInfo')
  .sort({ createdAt: -1 });
};

// Static method to get application statistics
applicationSchema.statics.getStatistics = function(filters = {}) {
  const pipeline = [
    { $match: filters },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 }
      }
    }
  ];
  
  return this.aggregate(pipeline);
};

module.exports = mongoose.model('Application', applicationSchema);
