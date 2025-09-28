const express = require('express');
const { body, validationResult } = require('express-validator');
const Notification = require('../models/Notification');
const { authenticateToken, authorize } = require('../middleware/auth');

const router = express.Router();

// Get user notifications
router.get('/', authenticateToken, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      unreadOnly = false,
      type,
      priority
    } = req.query;

    const options = {
      unreadOnly: unreadOnly === 'true',
      type,
      priority,
      limit: parseInt(limit)
    };

    const notifications = await Notification.findByUser(req.user._id, options)
      .limit(parseInt(limit))
      .skip((page - 1) * parseInt(limit));

    const total = await Notification.countDocuments({
      user: req.user._id,
      ...(unreadOnly === 'true' ? { isRead: false } : {})
    });

    res.json({
      notifications,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({
      message: 'Failed to get notifications',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Get notification by ID
router.get('/:notificationId', authenticateToken, async (req, res) => {
  try {
    const { notificationId } = req.params;

    const notification = await Notification.findById(notificationId);

    if (!notification) {
      return res.status(404).json({
        message: 'Notification not found'
      });
    }

    // Check if user can access this notification
    if (notification.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        message: 'Access denied'
      });
    }

    res.json({
      notification
    });
  } catch (error) {
    console.error('Get notification error:', error);
    res.status(500).json({
      message: 'Failed to get notification',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Mark notification as read
router.put('/:notificationId/read', authenticateToken, async (req, res) => {
  try {
    const { notificationId } = req.params;

    const notification = await Notification.findById(notificationId);

    if (!notification) {
      return res.status(404).json({
        message: 'Notification not found'
      });
    }

    // Check if user can access this notification
    if (notification.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        message: 'Access denied'
      });
    }

    await notification.markAsRead();

    res.json({
      message: 'Notification marked as read',
      notification
    });
  } catch (error) {
    console.error('Mark notification as read error:', error);
    res.status(500).json({
      message: 'Failed to mark notification as read',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Mark notification as unread
router.put('/:notificationId/unread', authenticateToken, async (req, res) => {
  try {
    const { notificationId } = req.params;

    const notification = await Notification.findById(notificationId);

    if (!notification) {
      return res.status(404).json({
        message: 'Notification not found'
      });
    }

    // Check if user can access this notification
    if (notification.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        message: 'Access denied'
      });
    }

    await notification.markAsUnread();

    res.json({
      message: 'Notification marked as unread',
      notification
    });
  } catch (error) {
    console.error('Mark notification as unread error:', error);
    res.status(500).json({
      message: 'Failed to mark notification as unread',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Mark all notifications as read
router.put('/mark-all-read', authenticateToken, async (req, res) => {
  try {
    await Notification.markAllAsRead(req.user._id);

    res.json({
      message: 'All notifications marked as read'
    });
  } catch (error) {
    console.error('Mark all notifications as read error:', error);
    res.status(500).json({
      message: 'Failed to mark all notifications as read',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Get unread notification count
router.get('/unread/count', authenticateToken, async (req, res) => {
  try {
    const count = await Notification.getUnreadCount(req.user._id);

    res.json({
      unreadCount: count
    });
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({
      message: 'Failed to get unread count',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Create notification (admin/system only)
router.post('/', authenticateToken, authorize('admin'), [
  body('user').isMongoId().withMessage('Valid user ID is required'),
  body('title').notEmpty().isLength({ max: 100 }).withMessage('Title is required and must be less than 100 characters'),
  body('message').notEmpty().isLength({ max: 500 }).withMessage('Message is required and must be less than 500 characters'),
  body('type').isIn(['application-status', 'interview-scheduled', 'offer-extended', 'feedback-received', 'job-posted', 'deadline-reminder', 'approval-required', 'system-announcement', 'general']).withMessage('Invalid notification type'),
  body('priority').optional().isIn(['low', 'medium', 'high', 'urgent']).withMessage('Invalid priority'),
  body('relatedEntity.type').optional().isIn(['application', 'job', 'interview', 'offer', 'feedback']).withMessage('Invalid related entity type'),
  body('relatedEntity.id').optional().isMongoId().withMessage('Valid related entity ID is required'),
  body('action.type').optional().isIn(['view', 'apply', 'approve', 'reject', 'schedule', 'accept', 'decline']).withMessage('Invalid action type'),
  body('action.url').optional().isURL().withMessage('Action URL must be a valid URL'),
  body('action.buttonText').optional().isLength({ max: 50 }).withMessage('Button text must be less than 50 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const notificationData = {
      ...req.body,
      priority: req.body.priority || 'medium'
    };

    const notification = await Notification.createNotification(notificationData);

    res.status(201).json({
      message: 'Notification created successfully',
      notification
    });
  } catch (error) {
    console.error('Create notification error:', error);
    res.status(500).json({
      message: 'Failed to create notification',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Create bulk notifications (admin/system only)
router.post('/bulk', authenticateToken, authorize('admin'), [
  body('notifications').isArray({ min: 1 }).withMessage('Notifications array is required'),
  body('notifications.*.user').isMongoId().withMessage('Valid user ID is required for each notification'),
  body('notifications.*.title').notEmpty().isLength({ max: 100 }).withMessage('Title is required and must be less than 100 characters'),
  body('notifications.*.message').notEmpty().isLength({ max: 500 }).withMessage('Message is required and must be less than 500 characters'),
  body('notifications.*.type').isIn(['application-status', 'interview-scheduled', 'offer-extended', 'feedback-received', 'job-posted', 'deadline-reminder', 'approval-required', 'system-announcement', 'general']).withMessage('Invalid notification type')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { notifications } = req.body;

    const createdNotifications = await Notification.createBulkNotifications(notifications);

    res.status(201).json({
      message: 'Bulk notifications created successfully',
      notifications: createdNotifications,
      count: createdNotifications.length
    });
  } catch (error) {
    console.error('Create bulk notifications error:', error);
    res.status(500).json({
      message: 'Failed to create bulk notifications',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Update notification preferences
router.put('/preferences', authenticateToken, [
  body('email').optional().isBoolean().withMessage('Email preference must be a boolean'),
  body('push').optional().isBoolean().withMessage('Push preference must be a boolean'),
  body('sms').optional().isBoolean().withMessage('SMS preference must be a boolean')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { email, push, sms } = req.body;

    // Update user notification preferences
    const User = require('../models/User');
    const user = await User.findById(req.user._id);
    
    if (email !== undefined) {
      user.notifications.email = email;
    }
    if (push !== undefined) {
      user.notifications.push = push;
    }
    if (sms !== undefined) {
      user.notifications.sms = sms;
    }

    await user.save();

    res.json({
      message: 'Notification preferences updated successfully',
      preferences: user.notifications
    });
  } catch (error) {
    console.error('Update notification preferences error:', error);
    res.status(500).json({
      message: 'Failed to update notification preferences',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Get notification statistics
router.get('/statistics/overview', authenticateToken, async (req, res) => {
  try {
    const { startDate, endDate, type, priority } = req.query;

    const filters = { user: req.user._id };

    if (startDate && endDate) {
      filters.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    if (type) {
      filters.type = type;
    }

    if (priority) {
      filters.priority = priority;
    }

    const statistics = await Notification.getStatistics(req.user._id, filters);

    res.json({
      statistics: statistics[0] || {
        total: 0,
        unread: 0,
        byType: []
      }
    });
  } catch (error) {
    console.error('Get notification statistics error:', error);
    res.status(500).json({
      message: 'Failed to get notification statistics',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Delete notification
router.delete('/:notificationId', authenticateToken, async (req, res) => {
  try {
    const { notificationId } = req.params;

    const notification = await Notification.findById(notificationId);

    if (!notification) {
      return res.status(404).json({
        message: 'Notification not found'
      });
    }

    // Check if user can delete this notification
    if (notification.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        message: 'Access denied'
      });
    }

    await Notification.findByIdAndDelete(notificationId);

    res.json({
      message: 'Notification deleted successfully'
    });
  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({
      message: 'Failed to delete notification',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Cleanup expired notifications (admin only)
router.delete('/cleanup/expired', authenticateToken, authorize('admin'), async (req, res) => {
  try {
    const result = await Notification.cleanupExpired();

    res.json({
      message: 'Expired notifications cleaned up successfully',
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error('Cleanup expired notifications error:', error);
    res.status(500).json({
      message: 'Failed to cleanup expired notifications',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Send test notification (admin only)
router.post('/test', authenticateToken, authorize('admin'), [
  body('userId').isMongoId().withMessage('Valid user ID is required'),
  body('title').notEmpty().isLength({ max: 100 }).withMessage('Title is required and must be less than 100 characters'),
  body('message').notEmpty().isLength({ max: 500 }).withMessage('Message is required and must be less than 500 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { userId, title, message } = req.body;

    const notification = await Notification.createNotification({
      user: userId,
      title,
      message,
      type: 'system-announcement',
      priority: 'medium'
    });

    res.status(201).json({
      message: 'Test notification sent successfully',
      notification
    });
  } catch (error) {
    console.error('Send test notification error:', error);
    res.status(500).json({
      message: 'Failed to send test notification',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

module.exports = router;
