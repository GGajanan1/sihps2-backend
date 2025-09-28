const express = require('express');
const { body, validationResult } = require('express-validator');
const Job = require('../models/Job');
const Application = require('../models/Application');
const { authenticateToken, authorize, authorizeJobAccess } = require('../middleware/auth');

const router = express.Router();

// Get all jobs with filters
router.get('/', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      type,
      category,
      department,
      company,
      location,
      minStipend,
      maxStipend,
      search,
      status = 'active',
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const query = {};

    // Status filter
    if (status) {
      query.status = status;
    }

    // Type filter
    if (type) {
      query.type = type;
    }

    // Category filter
    if (category) {
      query.category = category;
    }

    // Department filter
    if (department) {
      query['requirements.departments'] = department;
    }

    // Company filter
    if (company) {
      query['company.name'] = new RegExp(company, 'i');
    }

    // Location filter
    if (location) {
      query['company.location.city'] = new RegExp(location, 'i');
    }

    // Stipend range filter
    if (minStipend || maxStipend) {
      query['compensation.stipend'] = {};
      if (minStipend) {
        query['compensation.stipend.min'] = { $gte: parseInt(minStipend) };
      }
      if (maxStipend) {
        query['compensation.stipend.max'] = { $lte: parseInt(maxStipend) };
      }
    }

    // Search filter
    if (search) {
      query.$or = [
        { title: new RegExp(search, 'i') },
        { description: new RegExp(search, 'i') },
        { 'company.name': new RegExp(search, 'i') },
        { tags: new RegExp(search, 'i') }
      ];
    }

    // Sort options
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const jobs = await Job.find(query)
      .populate('postedBy', 'firstName lastName employerInfo')
      .sort(sortOptions)
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Job.countDocuments(query);

    res.json({
      jobs,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    console.error('Get jobs error:', error);
    res.status(500).json({
      message: 'Failed to get jobs',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Get job by ID
router.get('/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;

    const job = await Job.findById(jobId)
      .populate('postedBy', 'firstName lastName employerInfo');

    if (!job) {
      return res.status(404).json({
        message: 'Job not found'
      });
    }

    // Increment view count
    await job.incrementViews();

    res.json({
      job
    });
  } catch (error) {
    console.error('Get job error:', error);
    res.status(500).json({
      message: 'Failed to get job',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Create new job
router.post('/', authenticateToken, authorize('employer', 'admin'), [
  body('title').trim().isLength({ min: 5 }).withMessage('Title must be at least 5 characters'),
  body('description').trim().isLength({ min: 50 }).withMessage('Description must be at least 50 characters'),
  body('type').isIn(['internship', 'full-time', 'part-time', 'contract', 'freelance']).withMessage('Invalid job type'),
  body('category').isIn(['software', 'data-science', 'design', 'marketing', 'finance', 'operations', 'other']).withMessage('Invalid category'),
  body('company.name').trim().isLength({ min: 2 }).withMessage('Company name must be at least 2 characters'),
  body('requirements.skills').isArray().withMessage('Skills must be an array'),
  body('compensation.stipend.min').optional().isInt({ min: 0 }).withMessage('Minimum stipend must be a positive number'),
  body('compensation.stipend.max').optional().isInt({ min: 0 }).withMessage('Maximum stipend must be a positive number'),
  body('application.deadline').isISO8601().withMessage('Invalid deadline format'),
  body('application.maxApplications').isInt({ min: 1 }).withMessage('Max applications must be at least 1')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const jobData = {
      ...req.body,
      postedBy: req.user._id
    };

    // Set status based on user role
    if (req.user.role === 'admin') {
      jobData.status = 'active';
      jobData.approvedBy = req.user._id;
      jobData.approvedAt = new Date();
    } else {
      jobData.status = 'draft';
    }

    const job = new Job(jobData);
    await job.save();

    res.status(201).json({
      message: 'Job created successfully',
      job
    });
  } catch (error) {
    console.error('Create job error:', error);
    res.status(500).json({
      message: 'Failed to create job',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Update job
router.put('/:jobId', authenticateToken, authorizeJobAccess, [
  body('title').optional().trim().isLength({ min: 5 }).withMessage('Title must be at least 5 characters'),
  body('description').optional().trim().isLength({ min: 50 }).withMessage('Description must be at least 50 characters'),
  body('type').optional().isIn(['internship', 'full-time', 'part-time', 'contract', 'freelance']).withMessage('Invalid job type'),
  body('category').optional().isIn(['software', 'data-science', 'design', 'marketing', 'finance', 'operations', 'other']).withMessage('Invalid category'),
  body('company.name').optional().trim().isLength({ min: 2 }).withMessage('Company name must be at least 2 characters'),
  body('requirements.skills').optional().isArray().withMessage('Skills must be an array'),
  body('compensation.stipend.min').optional().isInt({ min: 0 }).withMessage('Minimum stipend must be a positive number'),
  body('compensation.stipend.max').optional().isInt({ min: 0 }).withMessage('Maximum stipend must be a positive number'),
  body('application.deadline').optional().isISO8601().withMessage('Invalid deadline format'),
  body('application.maxApplications').optional().isInt({ min: 1 }).withMessage('Max applications must be at least 1')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { jobId } = req.params;
    const updates = req.body;

    const job = await Job.findById(jobId);
    if (!job) {
      return res.status(404).json({
        message: 'Job not found'
      });
    }

    // Check if user can update this job
    if (req.user.role !== 'admin' && job.postedBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        message: 'Access denied'
      });
    }

    // Update job
    Object.assign(job, updates);
    await job.save();

    res.json({
      message: 'Job updated successfully',
      job
    });
  } catch (error) {
    console.error('Update job error:', error);
    res.status(500).json({
      message: 'Failed to update job',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Delete job
router.delete('/:jobId', authenticateToken, authorizeJobAccess, async (req, res) => {
  try {
    const { jobId } = req.params;

    const job = await Job.findById(jobId);
    if (!job) {
      return res.status(404).json({
        message: 'Job not found'
      });
    }

    // Check if user can delete this job
    if (req.user.role !== 'admin' && job.postedBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        message: 'Access denied'
      });
    }

    await Job.findByIdAndDelete(jobId);

    res.json({
      message: 'Job deleted successfully'
    });
  } catch (error) {
    console.error('Delete job error:', error);
    res.status(500).json({
      message: 'Failed to delete job',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Approve job (admin only)
router.put('/:jobId/approve', authenticateToken, authorize('admin'), async (req, res) => {
  try {
    const { jobId } = req.params;

    const job = await Job.findById(jobId);
    if (!job) {
      return res.status(404).json({
        message: 'Job not found'
      });
    }

    job.status = 'active';
    job.approvedBy = req.user._id;
    job.approvedAt = new Date();
    await job.save();

    res.json({
      message: 'Job approved successfully',
      job
    });
  } catch (error) {
    console.error('Approve job error:', error);
    res.status(500).json({
      message: 'Failed to approve job',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Get jobs by employer
router.get('/employer/:employerId', authenticateToken, async (req, res) => {
  try {
    const { employerId } = req.params;
    const { page = 1, limit = 10, status } = req.query;

    const query = { postedBy: employerId };

    if (status) {
      query.status = status;
    }

    const jobs = await Job.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Job.countDocuments(query);

    res.json({
      jobs,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    console.error('Get jobs by employer error:', error);
    res.status(500).json({
      message: 'Failed to get jobs',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Get job applications
router.get('/:jobId/applications', authenticateToken, authorizeJobAccess, async (req, res) => {
  try {
    const { jobId } = req.params;
    const { page = 1, limit = 10, status } = req.query;

    const query = { job: jobId };

    if (status) {
      query.status = status;
    }

    const applications = await Application.find(query)
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
    console.error('Get job applications error:', error);
    res.status(500).json({
      message: 'Failed to get applications',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Get job statistics
router.get('/:jobId/statistics', authenticateToken, authorizeJobAccess, async (req, res) => {
  try {
    const { jobId } = req.params;

    const job = await Job.findById(jobId);
    if (!job) {
      return res.status(404).json({
        message: 'Job not found'
      });
    }

    const applications = await Application.find({ job: jobId });
    const statusCounts = await Application.getStatistics({ job: jobId });

    const statistics = {
      totalApplications: applications.length,
      statusCounts: statusCounts.reduce((acc, item) => {
        acc[item._id] = item.count;
        return acc;
      }, {}),
      views: job.analytics.views,
      conversionRate: job.analytics.applications > 0 ? 
        (job.analytics.hired / job.analytics.applications * 100).toFixed(2) : 0
    };

    res.json({
      statistics
    });
  } catch (error) {
    console.error('Get job statistics error:', error);
    res.status(500).json({
      message: 'Failed to get job statistics',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Search jobs
router.get('/search/:query', async (req, res) => {
  try {
    const { query } = req.params;
    const { page = 1, limit = 10 } = req.query;

    const jobs = await Job.search(query, { status: 'active' })
      .populate('postedBy', 'firstName lastName employerInfo')
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Job.countDocuments({
      $text: { $search: query },
      status: 'active'
    });

    res.json({
      jobs,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    console.error('Search jobs error:', error);
    res.status(500).json({
      message: 'Failed to search jobs',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Get recommended jobs for student
router.get('/recommendations/:studentId', authenticateToken, async (req, res) => {
  try {
    const { studentId } = req.params;
    const { limit = 10 } = req.query;

    // Get student info
    const User = require('../models/User');
    const student = await User.findById(studentId);
    if (!student || student.role !== 'student') {
      return res.status(404).json({
        message: 'Student not found'
      });
    }

    const { skills, department, year } = student.studentInfo;

    // Build recommendation query
    const query = {
      status: 'active',
      'application.deadline': { $gt: new Date() }
    };

    // Filter by department if specified
    if (department) {
      query['requirements.departments'] = department;
    }

    // Filter by year if specified
    if (year) {
      query['requirements.year'] = year;
    }

    // Get jobs matching student skills
    const jobs = await Job.find(query)
      .populate('postedBy', 'firstName lastName employerInfo')
      .sort({ 'analytics.views': -1, createdAt: -1 })
      .limit(parseInt(limit));

    // Score jobs based on skill match
    const scoredJobs = jobs.map(job => {
      const jobSkills = job.requirements.skills || [];
      const matchingSkills = skills.filter(skill => 
        jobSkills.some(jobSkill => 
          jobSkill.toLowerCase().includes(skill.toLowerCase()) ||
          skill.toLowerCase().includes(jobSkill.toLowerCase())
        )
      );
      
      const skillMatchScore = jobSkills.length > 0 ? 
        (matchingSkills.length / jobSkills.length) * 100 : 0;

      return {
        ...job.toObject(),
        recommendationScore: skillMatchScore
      };
    });

    // Sort by recommendation score
    scoredJobs.sort((a, b) => b.recommendationScore - a.recommendationScore);

    res.json({
      jobs: scoredJobs,
      total: scoredJobs.length
    });
  } catch (error) {
    console.error('Get job recommendations error:', error);
    res.status(500).json({
      message: 'Failed to get job recommendations',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

module.exports = router;
