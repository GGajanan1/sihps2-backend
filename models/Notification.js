const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  title: {
    type: String,
    required: true,
    maxlength: 100
  },
  message: {
    type: String,
    required: true,
    maxlength: 500
  },
  type: {
    type: String,
    enum: [
      'application-status',
      'interview-scheduled',
      'offer-extended',
      'feedback-received',
      'job-posted',
      'deadline-reminder',
      'approval-required',
      'system-announcement',
      'general'
    ],
    required: true
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  isRead: {
    type: Boolean,
    default: false
  },
  readAt: Date,
  // Related entities
  relatedEntity: {
    type: {
      type: String,
      enum: ['application', 'job', 'interview', 'offer', 'feedback']
    },
    id: mongoose.Schema.Types.ObjectId
  },
  // Action data
  action: {
    type: {
      type: String,
      enum: ['view', 'apply', 'approve', 'reject', 'schedule', 'accept', 'decline']
    },
    url: String,
    buttonText: String
  },
  // Email notification
  emailSent: {
    type: Boolean,
    default: false
  },
  emailSentAt: Date,
  emailError: String,
  // Push notification
  pushSent: {
    type: Boolean,
    default: false
  },
  pushSentAt: Date,
  pushError: String,
  // SMS notification
  smsSent: {
    type: Boolean,
    default: false
  },
  smsSentAt: Date,
  smsError: String,
  // Notification metadata
  metadata: {
    source: String,
    category: String,
    tags: [String],
    expiresAt: Date
  },
  // Delivery preferences
  deliveryPreferences: {
    email: {
      type: Boolean,
      default: true
    },
    push: {
      type: Boolean,
      default: true
    },
    sms: {
      type: Boolean,
      default: false
    }
  }
}, {
  timestamps: true
});

// Indexes
notificationSchema.index({ user: 1, createdAt: -1 });
notificationSchema.index({ user: 1, isRead: 1 });
notificationSchema.index({ type: 1 });
notificationSchema.index({ priority: 1 });
notificationSchema.index({ 'relatedEntity.type': 1, 'relatedEntity.id': 1 });
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Virtual for notification age
notificationSchema.virtual('ageInHours').get(function() {
  const now = new Date();
  const created = new Date(this.createdAt);
  const diffTime = now - created;
  return Math.floor(diffTime / (1000 * 60 * 60));
});

// Virtual for is expired
notificationSchema.virtual('isExpired').get(function() {
  if (!this.metadata.expiresAt) return false;
  return new Date() > this.metadata.expiresAt;
});

// Pre-save middleware
notificationSchema.pre('save', function(next) {
  // Set default expiration to 30 days if not specified
  if (!this.metadata.expiresAt) {
    this.metadata.expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  }
  next();
});

// Method to mark as read
notificationSchema.methods.markAsRead = function() {
  this.isRead = true;
  this.readAt = new Date();
  return this.save();
};

// Method to mark as unread
notificationSchema.methods.markAsUnread = function() {
  this.isRead = false;
  this.readAt = undefined;
  return this.save();
};

// Method to update delivery status
notificationSchema.methods.updateDeliveryStatus = function(channel, success, error = null) {
  const statusField = `${channel}Sent`;
  const timeField = `${channel}SentAt`;
  const errorField = `${channel}Error`;
  
  this[statusField] = success;
  this[timeField] = success ? new Date() : undefined;
  this[errorField] = error;
  
  return this.save();
};

// Static method to find by user
notificationSchema.statics.findByUser = function(userId, options = {}) {
  const query = { user: userId };
  
  if (options.unreadOnly) {
    query.isRead = false;
  }
  
  if (options.type) {
    query.type = options.type;
  }
  
  if (options.priority) {
    query.priority = options.priority;
  }
  
  return this.find(query)
    .sort({ createdAt: -1 })
    .limit(options.limit || 50);
};

// Static method to mark all as read for user
notificationSchema.statics.markAllAsRead = function(userId) {
  return this.updateMany(
    { user: userId, isRead: false },
    { 
      isRead: true, 
      readAt: new Date() 
    }
  );
};

// Static method to get unread count
notificationSchema.statics.getUnreadCount = function(userId) {
  return this.countDocuments({ 
    user: userId, 
    isRead: false 
  });
};

// Static method to create notification
notificationSchema.statics.createNotification = function(data) {
  const notification = new this(data);
  return notification.save();
};

// Static method to create bulk notifications
notificationSchema.statics.createBulkNotifications = function(notifications) {
  return this.insertMany(notifications);
};

// Static method to cleanup expired notifications
notificationSchema.statics.cleanupExpired = function() {
  return this.deleteMany({
    'metadata.expiresAt': { $lt: new Date() }
  });
};

// Static method to get notification statistics
notificationSchema.statics.getStatistics = function(userId, filters = {}) {
  const matchQuery = { user: userId, ...filters };
  
  return this.aggregate([
    { $match: matchQuery },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        unread: {
          $sum: { $cond: ['$isRead', 0, 1] }
        },
        byType: {
          $push: {
            type: '$type',
            isRead: '$isRead'
          }
        }
      }
    }
  ]);
};

module.exports = mongoose.model('Notification', notificationSchema);
