const express = require('express');
const { body, validationResult } = require('express-validator');
const Application = require('../models/Application');
const Job = require('../models/Job');
const User = require('../models/User');
const { authenticateToken, authorize, authorizeApplicationAccess } = require('../middleware/auth');

const router = express.Router();

// Get all applications with filters
router.get('/', authenticateToken, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      status,
      jobId,
      studentId,
      employerId
    } = req.query;

    const query = {};

    // Status filter
    if (status) {
      query.status = status;
    }

    // Job filter
    if (jobId) {
      query.job = jobId;
    }

    // Student filter
    if (studentId) {
      query.student = studentId;
    }

    // Employer filter (applications for jobs posted by employer)
    if (employerId) {
      const jobs = await Job.find({ postedBy: employerId }).select('_id');
      const jobIds = jobs.map(job => job._id);
      query.job = { $in: jobIds };
    }

    // Role-based filtering
    if (req.user.role === 'student') {
      query.student = req.user._id;
    } else if (req.user.role === 'employer') {
      const jobs = await Job.find({ postedBy: req.user._id }).select('_id');
      const jobIds = jobs.map(job => job._id);
      query.job = { $in: jobIds };
    }

    const applications = await Application.find(query)
      .populate('job', 'title company type status')
      .populate('student', 'firstName lastName email studentInfo')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Application.countDocuments(query);

    res.json({
      applications,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    console.error('Get applications error:', error);
    res.status(500).json({
      message: 'Failed to get applications',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Get application by ID
router.get('/:applicationId', authenticateToken, authorizeApplicationAccess, async (req, res) => {
  try {
    const { applicationId } = req.params;

    const application = await Application.findById(applicationId)
      .populate('job', 'title company type status requirements')
      .populate('student', 'firstName lastName email studentInfo')
      .populate('timeline.updatedBy', 'firstName lastName');

    if (!application) {
      return res.status(404).json({
        message: 'Application not found'
      });
    }

    res.json({
      application
    });
  } catch (error) {
    console.error('Get application error:', error);
    res.status(500).json({
      message: 'Failed to get application',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Create new application
router.post('/', authenticateToken, authorize('student'), [
  body('jobId').isMongoId().withMessage('Valid job ID is required'),
  body('applicationData.resume').optional().isURL().withMessage('Resume must be a valid URL'),
  body('applicationData.coverLetter').optional().isLength({ max: 2000 }).withMessage('Cover letter must be less than 2000 characters'),
  body('applicationData.portfolio').optional().isURL().withMessage('Portfolio must be a valid URL')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { jobId, applicationData } = req.body;

    // Check if job exists and is active
    const job = await Job.findById(jobId);
    if (!job) {
      return res.status(404).json({
        message: 'Job not found'
      });
    }

    if (job.status !== 'active') {
      return res.status(400).json({
        message: 'Job is not active'
      });
    }

    if (!job.isOpen) {
      return res.status(400).json({
        message: 'Job is no longer accepting applications'
      });
    }

    // Check if student has already applied
    const existingApplication = await Application.findOne({
      job: jobId,
      student: req.user._id
    });

    if (existingApplication) {
      return res.status(400).json({
        message: 'You have already applied for this job'
      });
    }

    // Check if student meets requirements
    const student = await User.findById(req.user._id);
    const { skills, department, year, cgpa } = student.studentInfo;

    // Check department requirement
    if (job.requirements.departments && job.requirements.departments.length > 0) {
      if (!job.requirements.departments.includes(department)) {
        return res.status(400).json({
          message: 'You do not meet the department requirement for this job'
        });
      }
    }

    // Check year requirement
    if (job.requirements.year && job.requirements.year.length > 0) {
      if (!job.requirements.year.includes(year)) {
        return res.status(400).json({
          message: 'You do not meet the year requirement for this job'
        });
      }
    }

    // Check CGPA requirement
    if (job.requirements.education && job.requirements.education.minimumCGPA) {
      if (cgpa < job.requirements.education.minimumCGPA) {
        return res.status(400).json({
          message: 'You do not meet the minimum CGPA requirement for this job'
        });
      }
    }

    // Create application
    const application = new Application({
      job: jobId,
      student: req.user._id,
      applicationData,
      facultyApproval: {
        required: true, // This could be configurable
        status: 'pending'
      }
    });

    await application.save();

    // Update job application count
    job.application.currentApplications += 1;
    await job.save();

    // Populate the application for response
    await application.populate('job', 'title company type');
    await application.populate('student', 'firstName lastName email');

    res.status(201).json({
      message: 'Application submitted successfully',
      application
    });
  } catch (error) {
    console.error('Create application error:', error);
    res.status(500).json({
      message: 'Failed to create application',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Update application status
router.put('/:applicationId/status', authenticateToken, authorizeApplicationAccess, [
  body('status').isIn(['applied', 'under-review', 'shortlisted', 'rejected', 'interview-scheduled', 'interview-completed', 'offer-extended', 'offer-accepted', 'offer-declined', 'completed']).withMessage('Invalid status'),
  body('comments').optional().isLength({ max: 500 }).withMessage('Comments must be less than 500 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { applicationId } = req.params;
    const { status, comments } = req.body;

    const application = await Application.findById(applicationId);
    if (!application) {
      return res.status(404).json({
        message: 'Application not found'
      });
    }

    // Update status
    await application.updateStatus(status, req.user._id, comments);

    res.json({
      message: 'Application status updated successfully',
      application
    });
  } catch (error) {
    console.error('Update application status error:', error);
    res.status(500).json({
      message: 'Failed to update application status',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Faculty approval for application
router.put('/:applicationId/faculty-approval', authenticateToken, authorize('faculty', 'admin'), [
  body('status').isIn(['approved', 'rejected']).withMessage('Status must be approved or rejected'),
  body('comments').optional().isLength({ max: 500 }).withMessage('Comments must be less than 500 characters'),
  body('rejectionReason').optional().isLength({ max: 200 }).withMessage('Rejection reason must be less than 200 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { applicationId } = req.params;
    const { status, comments, rejectionReason } = req.body;

    const application = await Application.findById(applicationId);
    if (!application) {
      return res.status(404).json({
        message: 'Application not found'
      });
    }

    if (!application.facultyApproval.required) {
      return res.status(400).json({
        message: 'Faculty approval is not required for this application'
      });
    }

    // Update faculty approval
    application.facultyApproval.status = status;
    application.facultyApproval.approvedBy = req.user._id;
    application.facultyApproval.approvedAt = new Date();
    application.facultyApproval.comments = comments;

    if (status === 'rejected') {
      application.facultyApproval.rejectionReason = rejectionReason;
      application.status = 'rejected';
    } else {
      application.status = 'under-review';
    }

    await application.save();

    res.json({
      message: `Application ${status} by faculty`,
      application
    });
  } catch (error) {
    console.error('Faculty approval error:', error);
    res.status(500).json({
      message: 'Failed to process faculty approval',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Schedule interview
router.post('/:applicationId/interview', authenticateToken, authorizeApplicationAccess, [
  body('date').isISO8601().withMessage('Valid date is required'),
  body('time').notEmpty().withMessage('Time is required'),
  body('location').optional().trim().isLength({ min: 5 }).withMessage('Location must be at least 5 characters'),
  body('type').isIn(['online', 'offline', 'phone', 'video']).withMessage('Invalid interview type'),
  body('meetingLink').optional().isURL().withMessage('Meeting link must be a valid URL'),
  body('interviewer.name').notEmpty().withMessage('Interviewer name is required'),
  body('interviewer.email').isEmail().withMessage('Valid interviewer email is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { applicationId } = req.params;
    const interviewData = req.body;

    const application = await Application.findById(applicationId);
    if (!application) {
      return res.status(404).json({
        message: 'Application not found'
      });
    }

    // Update interview details
    application.interview = {
      scheduled: true,
      date: interviewData.date,
      time: interviewData.time,
      location: interviewData.location,
      type: interviewData.type,
      meetingLink: interviewData.meetingLink,
      interviewer: interviewData.interviewer,
      round: interviewData.round || 1
    };

    application.status = 'interview-scheduled';
    await application.save();

    res.json({
      message: 'Interview scheduled successfully',
      application
    });
  } catch (error) {
    console.error('Schedule interview error:', error);
    res.status(500).json({
      message: 'Failed to schedule interview',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Submit interview feedback
router.post('/:applicationId/interview-feedback', authenticateToken, authorizeApplicationAccess, [
  body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5'),
  body('comments').notEmpty().withMessage('Comments are required'),
  body('strengths').optional().isArray().withMessage('Strengths must be an array'),
  body('areasForImprovement').optional().isArray().withMessage('Areas for improvement must be an array'),
  body('result').isIn(['passed', 'failed', 'pending']).withMessage('Result must be passed, failed, or pending')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { applicationId } = req.params;
    const feedbackData = req.body;

    const application = await Application.findById(applicationId);
    if (!application) {
      return res.status(404).json({
        message: 'Application not found'
      });
    }

    // Update interview feedback
    application.interview.feedback = {
      rating: feedbackData.rating,
      comments: feedbackData.comments,
      strengths: feedbackData.strengths || [],
      areasForImprovement: feedbackData.areasForImprovement || []
    };

    application.interview.result = feedbackData.result;

    // Update application status based on result
    if (feedbackData.result === 'passed') {
      application.status = 'offer-extended';
    } else if (feedbackData.result === 'failed') {
      application.status = 'rejected';
    }

    await application.save();

    res.json({
      message: 'Interview feedback submitted successfully',
      application
    });
  } catch (error) {
    console.error('Submit interview feedback error:', error);
    res.status(500).json({
      message: 'Failed to submit interview feedback',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Extend offer
router.post('/:applicationId/offer', authenticateToken, authorizeApplicationAccess, [
  body('package.stipend').isInt({ min: 0 }).withMessage('Stipend must be a positive number'),
  body('package.currency').notEmpty().withMessage('Currency is required'),
  body('package.benefits').optional().isArray().withMessage('Benefits must be an array'),
  body('startDate').isISO8601().withMessage('Valid start date is required'),
  body('endDate').optional().isISO8601().withMessage('Valid end date is required'),
  body('terms').optional().isLength({ max: 1000 }).withMessage('Terms must be less than 1000 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { applicationId } = req.params;
    const offerData = req.body;

    const application = await Application.findById(applicationId);
    if (!application) {
      return res.status(404).json({
        message: 'Application not found'
      });
    }

    // Update offer details
    application.offer = {
      extended: true,
      extendedAt: new Date(),
      package: offerData.package,
      startDate: offerData.startDate,
      endDate: offerData.endDate,
      terms: offerData.terms
    };

    application.status = 'offer-extended';
    await application.save();

    res.json({
      message: 'Offer extended successfully',
      application
    });
  } catch (error) {
    console.error('Extend offer error:', error);
    res.status(500).json({
      message: 'Failed to extend offer',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Accept/Decline offer
router.put('/:applicationId/offer-response', authenticateToken, authorize('student'), [
  body('accepted').isBoolean().withMessage('Accepted must be a boolean'),
  body('declineReason').optional().isLength({ max: 200 }).withMessage('Decline reason must be less than 200 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { applicationId } = req.params;
    const { accepted, declineReason } = req.body;

    const application = await Application.findById(applicationId);
    if (!application) {
      return res.status(404).json({
        message: 'Application not found'
      });
    }

    if (application.student.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        message: 'Access denied'
      });
    }

    if (!application.offer.extended) {
      return res.status(400).json({
        message: 'No offer has been extended for this application'
      });
    }

    // Update offer response
    application.offer.accepted = accepted;
    if (accepted) {
      application.offer.acceptedAt = new Date();
      application.status = 'offer-accepted';
    } else {
      application.offer.declinedAt = new Date();
      application.offer.declineReason = declineReason;
      application.status = 'offer-declined';
    }

    await application.save();

    res.json({
      message: `Offer ${accepted ? 'accepted' : 'declined'} successfully`,
      application
    });
  } catch (error) {
    console.error('Offer response error:', error);
    res.status(500).json({
      message: 'Failed to process offer response',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Add message to application
router.post('/:applicationId/messages', authenticateToken, authorizeApplicationAccess, [
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

    const { applicationId } = req.params;
    const { message } = req.body;

    const application = await Application.findById(applicationId);
    if (!application) {
      return res.status(404).json({
        message: 'Application not found'
      });
    }

    // Add message
    await application.addMessage(req.user._id, message);

    res.json({
      message: 'Message added successfully',
      application
    });
  } catch (error) {
    console.error('Add message error:', error);
    res.status(500).json({
      message: 'Failed to add message',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Get application messages
router.get('/:applicationId/messages', authenticateToken, authorizeApplicationAccess, async (req, res) => {
  try {
    const { applicationId } = req.params;

    const application = await Application.findById(applicationId)
      .populate('messages.sender', 'firstName lastName role');

    if (!application) {
      return res.status(404).json({
        message: 'Application not found'
      });
    }

    res.json({
      messages: application.messages
    });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({
      message: 'Failed to get messages',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Get pending faculty approvals
router.get('/faculty/pending-approvals', authenticateToken, authorize('faculty', 'admin'), async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;

    const applications = await Application.findPendingFacultyApprovals()
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Application.countDocuments({
      'facultyApproval.status': 'pending',
      'facultyApproval.required': true
    });

    res.json({
      applications,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    console.error('Get pending approvals error:', error);
    res.status(500).json({
      message: 'Failed to get pending approvals',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Get application statistics
router.get('/statistics/overview', authenticateToken, async (req, res) => {
  try {
    const { startDate, endDate, department } = req.query;
    
    const filters = {};
    
    if (startDate && endDate) {
      filters.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    if (department && req.user.role === 'admin') {
      // This would require joining with User model
      // For now, we'll get all applications
    }

    const statistics = await Application.getStatistics(filters);

    res.json({
      statistics
    });
  } catch (error) {
    console.error('Get application statistics error:', error);
    res.status(500).json({
      message: 'Failed to get application statistics',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

module.exports = router;
