const express = require('express');
const { body, validationResult } = require('express-validator');
const Feedback = require('../models/Feedback');
const Application = require('../models/Application');
const { authenticateToken, authorize } = require('../middleware/auth');

const router = express.Router();

// Get all feedback with filters
router.get('/', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      type,
      studentId,
      employerId,
      jobId,
      isPublic = false,
      minRating,
      maxRating
    } = req.query;

    const query = {};

    // Type filter
    if (type) {
      query.type = type;
    }

    // Student filter
    if (studentId) {
      query.student = studentId;
    }

    // Employer filter
    if (employerId) {
      query.employer = employerId;
    }

    // Job filter
    if (jobId) {
      query.job = jobId;
    }

    // Public filter
    if (isPublic) {
      query.isPublic = true;
    }

    // Rating range filter
    if (minRating || maxRating) {
      query['rating.overall'] = {};
      if (minRating) {
        query['rating.overall'].$gte = parseInt(minRating);
      }
      if (maxRating) {
        query['rating.overall'].$lte = parseInt(maxRating);
      }
    }

    const feedback = await Feedback.find(query)
      .populate('student', 'firstName lastName studentInfo')
      .populate('employer', 'firstName lastName employerInfo')
      .populate('job', 'title company')
      .populate('application', 'status')
      .sort({ submittedAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Feedback.countDocuments(query);

    res.json({
      feedback,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    console.error('Get feedback error:', error);
    res.status(500).json({
      message: 'Failed to get feedback',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Get feedback by ID
router.get('/:feedbackId', async (req, res) => {
  try {
    const { feedbackId } = req.params;

    const feedback = await Feedback.findById(feedbackId)
      .populate('student', 'firstName lastName studentInfo')
      .populate('employer', 'firstName lastName employerInfo')
      .populate('job', 'title company')
      .populate('application', 'status');

    if (!feedback) {
      return res.status(404).json({
        message: 'Feedback not found'
      });
    }

    res.json({
      feedback
    });
  } catch (error) {
    console.error('Get feedback error:', error);
    res.status(500).json({
      message: 'Failed to get feedback',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Create new feedback
router.post('/', authenticateToken, [
  body('applicationId').isMongoId().withMessage('Valid application ID is required'),
  body('type').isIn(['employer-to-student', 'student-to-employer', 'faculty-to-student', 'student-to-faculty']).withMessage('Invalid feedback type'),
  body('rating.overall').isInt({ min: 1, max: 5 }).withMessage('Overall rating must be between 1 and 5'),
  body('rating.technical').optional().isInt({ min: 1, max: 5 }).withMessage('Technical rating must be between 1 and 5'),
  body('rating.communication').optional().isInt({ min: 1, max: 5 }).withMessage('Communication rating must be between 1 and 5'),
  body('rating.punctuality').optional().isInt({ min: 1, max: 5 }).withMessage('Punctuality rating must be between 1 and 5'),
  body('rating.teamwork').optional().isInt({ min: 1, max: 5 }).withMessage('Teamwork rating must be between 1 and 5'),
  body('rating.problemSolving').optional().isInt({ min: 1, max: 5 }).withMessage('Problem solving rating must be between 1 and 5'),
  body('comments').notEmpty().isLength({ max: 1000 }).withMessage('Comments are required and must be less than 1000 characters'),
  body('strengths').optional().isArray().withMessage('Strengths must be an array'),
  body('areasForImprovement').optional().isArray().withMessage('Areas for improvement must be an array'),
  body('wouldRecommend').optional().isBoolean().withMessage('Would recommend must be a boolean'),
  body('wouldHireAgain').optional().isBoolean().withMessage('Would hire again must be a boolean'),
  body('isAnonymous').optional().isBoolean().withMessage('Is anonymous must be a boolean'),
  body('isPublic').optional().isBoolean().withMessage('Is public must be a boolean')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const {
      applicationId,
      type,
      rating,
      comments,
      strengths,
      areasForImprovement,
      wouldRecommend,
      wouldHireAgain,
      isAnonymous,
      isPublic
    } = req.body;

    // Get application details
    const application = await Application.findById(applicationId)
      .populate('job')
      .populate('student');

    if (!application) {
      return res.status(404).json({
        message: 'Application not found'
      });
    }

    // Check if user can submit feedback for this application
    const canSubmitFeedback = 
      (req.user.role === 'employer' && application.job.postedBy.toString() === req.user._id.toString()) ||
      (req.user.role === 'student' && application.student._id.toString() === req.user._id.toString()) ||
      (req.user.role === 'faculty') ||
      (req.user.role === 'admin');

    if (!canSubmitFeedback) {
      return res.status(403).json({
        message: 'You are not authorized to submit feedback for this application'
      });
    }

    // Check if feedback already exists for this application and type
    const existingFeedback = await Feedback.findOne({
      application: applicationId,
      type: type
    });

    if (existingFeedback) {
      return res.status(400).json({
        message: 'Feedback already exists for this application and type'
      });
    }

    // Create feedback
    const feedbackData = {
      application: applicationId,
      student: application.student._id,
      employer: application.job.postedBy,
      job: application.job._id,
      type,
      rating,
      comments,
      strengths: strengths || [],
      areasForImprovement: areasForImprovement || [],
      wouldRecommend: wouldRecommend !== undefined ? wouldRecommend : true,
      wouldHireAgain: wouldHireAgain !== undefined ? wouldHireAgain : true,
      isAnonymous: isAnonymous || false,
      isPublic: isPublic || false
    };

    const feedback = new Feedback(feedbackData);
    await feedback.save();

    // Populate the feedback for response
    await feedback.populate('student', 'firstName lastName studentInfo');
    await feedback.populate('employer', 'firstName lastName employerInfo');
    await feedback.populate('job', 'title company');

    res.status(201).json({
      message: 'Feedback submitted successfully',
      feedback
    });
  } catch (error) {
    console.error('Create feedback error:', error);
    res.status(500).json({
      message: 'Failed to submit feedback',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Update feedback
router.put('/:feedbackId', authenticateToken, [
  body('rating.overall').optional().isInt({ min: 1, max: 5 }).withMessage('Overall rating must be between 1 and 5'),
  body('rating.technical').optional().isInt({ min: 1, max: 5 }).withMessage('Technical rating must be between 1 and 5'),
  body('rating.communication').optional().isInt({ min: 1, max: 5 }).withMessage('Communication rating must be between 1 and 5'),
  body('rating.punctuality').optional().isInt({ min: 1, max: 5 }).withMessage('Punctuality rating must be between 1 and 5'),
  body('rating.teamwork').optional().isInt({ min: 1, max: 5 }).withMessage('Teamwork rating must be between 1 and 5'),
  body('rating.problemSolving').optional().isInt({ min: 1, max: 5 }).withMessage('Problem solving rating must be between 1 and 5'),
  body('comments').optional().isLength({ max: 1000 }).withMessage('Comments must be less than 1000 characters'),
  body('strengths').optional().isArray().withMessage('Strengths must be an array'),
  body('areasForImprovement').optional().isArray().withMessage('Areas for improvement must be an array'),
  body('wouldRecommend').optional().isBoolean().withMessage('Would recommend must be a boolean'),
  body('wouldHireAgain').optional().isBoolean().withMessage('Would hire again must be a boolean'),
  body('isPublic').optional().isBoolean().withMessage('Is public must be a boolean')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { feedbackId } = req.params;
    const updates = req.body;

    const feedback = await Feedback.findById(feedbackId);
    if (!feedback) {
      return res.status(404).json({
        message: 'Feedback not found'
      });
    }

    // Check if user can update this feedback
    const canUpdateFeedback = 
      (req.user.role === 'admin') ||
      (feedback.employer.toString() === req.user._id.toString()) ||
      (feedback.student.toString() === req.user._id.toString());

    if (!canUpdateFeedback) {
      return res.status(403).json({
        message: 'You are not authorized to update this feedback'
      });
    }

    // Update feedback
    Object.assign(feedback, updates);
    await feedback.save();

    res.json({
      message: 'Feedback updated successfully',
      feedback
    });
  } catch (error) {
    console.error('Update feedback error:', error);
    res.status(500).json({
      message: 'Failed to update feedback',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Delete feedback
router.delete('/:feedbackId', authenticateToken, async (req, res) => {
  try {
    const { feedbackId } = req.params;

    const feedback = await Feedback.findById(feedbackId);
    if (!feedback) {
      return res.status(404).json({
        message: 'Feedback not found'
      });
    }

    // Check if user can delete this feedback
    const canDeleteFeedback = 
      (req.user.role === 'admin') ||
      (feedback.employer.toString() === req.user._id.toString()) ||
      (feedback.student.toString() === req.user._id.toString());

    if (!canDeleteFeedback) {
      return res.status(403).json({
        message: 'You are not authorized to delete this feedback'
      });
    }

    await Feedback.findByIdAndDelete(feedbackId);

    res.json({
      message: 'Feedback deleted successfully'
    });
  } catch (error) {
    console.error('Delete feedback error:', error);
    res.status(500).json({
      message: 'Failed to delete feedback',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Get feedback for specific student
router.get('/student/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;
    const { page = 1, limit = 10, type } = req.query;

    const query = { student: studentId };

    if (type) {
      query.type = type;
    }

    const feedback = await Feedback.findByStudent(studentId)
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Feedback.countDocuments(query);

    res.json({
      feedback,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    console.error('Get student feedback error:', error);
    res.status(500).json({
      message: 'Failed to get student feedback',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Get feedback for specific employer
router.get('/employer/:employerId', async (req, res) => {
  try {
    const { employerId } = req.params;
    const { page = 1, limit = 10, type } = req.query;

    const query = { employer: employerId };

    if (type) {
      query.type = type;
    }

    const feedback = await Feedback.findByEmployer(employerId)
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Feedback.countDocuments(query);

    res.json({
      feedback,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    console.error('Get employer feedback error:', error);
    res.status(500).json({
      message: 'Failed to get employer feedback',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Get average rating for student
router.get('/student/:studentId/average-rating', async (req, res) => {
  try {
    const { studentId } = req.params;

    const result = await Feedback.getAverageRatingForStudent(studentId);

    res.json({
      averageRating: result[0]?.averageRating || 0,
      totalFeedbacks: result[0]?.totalFeedbacks || 0,
      ratings: result[0]?.ratings || []
    });
  } catch (error) {
    console.error('Get average rating error:', error);
    res.status(500).json({
      message: 'Failed to get average rating',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Get feedback statistics
router.get('/statistics/overview', async (req, res) => {
  try {
    const { startDate, endDate, type, studentId, employerId } = req.query;

    const filters = {};

    if (startDate && endDate) {
      filters.submittedAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    if (type) {
      filters.type = type;
    }

    if (studentId) {
      filters.student = studentId;
    }

    if (employerId) {
      filters.employer = employerId;
    }

    const statistics = await Feedback.getStatistics(filters);

    res.json({
      statistics: statistics[0] || {
        totalFeedbacks: 0,
        averageRating: 0,
        highRatings: 0,
        lowRatings: 0
      }
    });
  } catch (error) {
    console.error('Get feedback statistics error:', error);
    res.status(500).json({
      message: 'Failed to get feedback statistics',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Verify feedback (admin only)
router.put('/:feedbackId/verify', authenticateToken, authorize('admin'), async (req, res) => {
  try {
    const { feedbackId } = req.params;

    const feedback = await Feedback.findById(feedbackId);
    if (!feedback) {
      return res.status(404).json({
        message: 'Feedback not found'
      });
    }

    feedback.isVerified = true;
    feedback.verifiedBy = req.user._id;
    feedback.verifiedAt = new Date();
    await feedback.save();

    res.json({
      message: 'Feedback verified successfully',
      feedback
    });
  } catch (error) {
    console.error('Verify feedback error:', error);
    res.status(500).json({
      message: 'Failed to verify feedback',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Add response to feedback
router.post('/:feedbackId/response', authenticateToken, [
  body('message').notEmpty().isLength({ max: 500 }).withMessage('Response message is required and must be less than 500 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { feedbackId } = req.params;
    const { message } = req.body;

    const feedback = await Feedback.findById(feedbackId);
    if (!feedback) {
      return res.status(404).json({
        message: 'Feedback not found'
      });
    }

    // Check if user can respond to this feedback
    const canRespond = 
      (feedback.student.toString() === req.user._id.toString()) ||
      (feedback.employer.toString() === req.user._id.toString()) ||
      (req.user.role === 'admin');

    if (!canRespond) {
      return res.status(403).json({
        message: 'You are not authorized to respond to this feedback'
      });
    }

    feedback.response = {
      from: req.user._id,
      message,
      submittedAt: new Date()
    };

    await feedback.save();

    res.json({
      message: 'Response added successfully',
      feedback
    });
  } catch (error) {
    console.error('Add feedback response error:', error);
    res.status(500).json({
      message: 'Failed to add response',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

module.exports = router;
