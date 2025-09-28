const express = require('express');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const { authenticateToken, authorize, authorizeOwnerOrAdmin } = require('../middleware/auth');

const router = express.Router();

// Get user profile by ID
router.get('/:userId', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Check if user can access this profile
    if (req.user.role !== 'admin' && req.user._id.toString() !== userId) {
      return res.status(403).json({
        message: 'Access denied'
      });
    }

    const user = await User.findById(userId).select('-password');
    if (!user) {
      return res.status(404).json({
        message: 'User not found'
      });
    }

    res.json({
      user: user.getPublicProfile()
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      message: 'Failed to get user',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Update user profile
router.put('/:userId', authenticateToken, authorizeOwnerOrAdmin, [
  body('firstName').optional().trim().isLength({ min: 2 }).withMessage('First name must be at least 2 characters'),
  body('lastName').optional().trim().isLength({ min: 2 }).withMessage('Last name must be at least 2 characters'),
  body('profile.phone').optional().isMobilePhone().withMessage('Please provide a valid phone number'),
  body('profile.address.city').optional().trim().isLength({ min: 2 }).withMessage('City must be at least 2 characters'),
  body('profile.address.state').optional().trim().isLength({ min: 2 }).withMessage('State must be at least 2 characters'),
  body('profile.address.country').optional().trim().isLength({ min: 2 }).withMessage('Country must be at least 2 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { userId } = req.params;
    const updates = req.body;

    // Remove fields that shouldn't be updated directly
    delete updates.password;
    delete updates.email;
    delete updates.role;
    delete updates.isActive;

    const user = await User.findByIdAndUpdate(
      userId,
      updates,
      { new: true, runValidators: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({
        message: 'User not found'
      });
    }

    res.json({
      message: 'Profile updated successfully',
      user: user.getPublicProfile()
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({
      message: 'Failed to update user',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Update student-specific information
router.put('/:userId/student-info', authenticateToken, authorizeOwnerOrAdmin, [
  body('studentInfo.rollNumber').optional().trim().notEmpty().withMessage('Roll number cannot be empty'),
  body('studentInfo.department').optional().trim().notEmpty().withMessage('Department cannot be empty'),
  body('studentInfo.year').optional().isInt({ min: 1, max: 4 }).withMessage('Year must be between 1 and 4'),
  body('studentInfo.semester').optional().isInt({ min: 1, max: 8 }).withMessage('Semester must be between 1 and 8'),
  body('studentInfo.cgpa').optional().isFloat({ min: 0, max: 10 }).withMessage('CGPA must be between 0 and 10'),
  body('studentInfo.skills').optional().isArray().withMessage('Skills must be an array')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { userId } = req.params;
    const { studentInfo } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        message: 'User not found'
      });
    }

    if (user.role !== 'student') {
      return res.status(400).json({
        message: 'User is not a student'
      });
    }

    // Update student info
    user.studentInfo = { ...user.studentInfo, ...studentInfo };
    await user.save();

    res.json({
      message: 'Student information updated successfully',
      user: user.getPublicProfile()
    });
  } catch (error) {
    console.error('Update student info error:', error);
    res.status(500).json({
      message: 'Failed to update student information',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Update faculty-specific information
router.put('/:userId/faculty-info', authenticateToken, authorizeOwnerOrAdmin, [
  body('facultyInfo.employeeId').optional().trim().notEmpty().withMessage('Employee ID cannot be empty'),
  body('facultyInfo.department').optional().trim().notEmpty().withMessage('Department cannot be empty'),
  body('facultyInfo.designation').optional().trim().notEmpty().withMessage('Designation cannot be empty'),
  body('facultyInfo.experience').optional().isInt({ min: 0 }).withMessage('Experience must be a positive integer')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { userId } = req.params;
    const { facultyInfo } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        message: 'User not found'
      });
    }

    if (user.role !== 'faculty') {
      return res.status(400).json({
        message: 'User is not a faculty member'
      });
    }

    // Update faculty info
    user.facultyInfo = { ...user.facultyInfo, ...facultyInfo };
    await user.save();

    res.json({
      message: 'Faculty information updated successfully',
      user: user.getPublicProfile()
    });
  } catch (error) {
    console.error('Update faculty info error:', error);
    res.status(500).json({
      message: 'Failed to update faculty information',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Update employer-specific information
router.put('/:userId/employer-info', authenticateToken, authorizeOwnerOrAdmin, [
  body('employerInfo.companyName').optional().trim().notEmpty().withMessage('Company name cannot be empty'),
  body('employerInfo.industry').optional().trim().notEmpty().withMessage('Industry cannot be empty'),
  body('employerInfo.website').optional().isURL().withMessage('Please provide a valid website URL'),
  body('employerInfo.description').optional().trim().isLength({ max: 1000 }).withMessage('Description must be less than 1000 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { userId } = req.params;
    const { employerInfo } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        message: 'User not found'
      });
    }

    if (user.role !== 'employer') {
      return res.status(400).json({
        message: 'User is not an employer'
      });
    }

    // Update employer info
    user.employerInfo = { ...user.employerInfo, ...employerInfo };
    await user.save();

    res.json({
      message: 'Employer information updated successfully',
      user: user.getPublicProfile()
    });
  } catch (error) {
    console.error('Update employer info error:', error);
    res.status(500).json({
      message: 'Failed to update employer information',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Upload resume (students only)
router.post('/:userId/upload-resume', authenticateToken, authorizeOwnerOrAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { resumeUrl } = req.body;

    if (!resumeUrl) {
      return res.status(400).json({
        message: 'Resume URL is required'
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        message: 'User not found'
      });
    }

    if (user.role !== 'student') {
      return res.status(400).json({
        message: 'User is not a student'
      });
    }

    user.studentInfo.resume = resumeUrl;
    await user.save();

    res.json({
      message: 'Resume uploaded successfully',
      user: user.getPublicProfile()
    });
  } catch (error) {
    console.error('Upload resume error:', error);
    res.status(500).json({
      message: 'Failed to upload resume',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Get students by department
router.get('/students/department/:department', authenticateToken, async (req, res) => {
  try {
    const { department } = req.params;
    const { page = 1, limit = 10, year, semester } = req.query;

    const query = {
      role: 'student',
      'studentInfo.department': department
    };

    if (year) {
      query['studentInfo.year'] = parseInt(year);
    }

    if (semester) {
      query['studentInfo.semester'] = parseInt(semester);
    }

    const students = await User.find(query)
      .select('-password')
      .sort({ 'studentInfo.rollNumber': 1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await User.countDocuments(query);

    res.json({
      students,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    console.error('Get students by department error:', error);
    res.status(500).json({
      message: 'Failed to get students',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Get faculty by department
router.get('/faculty/department/:department', authenticateToken, async (req, res) => {
  try {
    const { department } = req.params;

    const faculty = await User.find({
      role: 'faculty',
      'facultyInfo.department': department
    }).select('-password');

    res.json({
      faculty
    });
  } catch (error) {
    console.error('Get faculty by department error:', error);
    res.status(500).json({
      message: 'Failed to get faculty',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Get all students (admin only)
router.get('/students/all', authenticateToken, authorize('admin'), async (req, res) => {
  try {
    const { page = 1, limit = 10, department, year, isPlaced } = req.query;

    const query = { role: 'student' };

    if (department) {
      query['studentInfo.department'] = department;
    }

    if (year) {
      query['studentInfo.year'] = parseInt(year);
    }

    if (isPlaced !== undefined) {
      query['studentInfo.isPlaced'] = isPlaced === 'true';
    }

    const students = await User.find(query)
      .select('-password')
      .sort({ 'studentInfo.rollNumber': 1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await User.countDocuments(query);

    res.json({
      students,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    console.error('Get all students error:', error);
    res.status(500).json({
      message: 'Failed to get students',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Get all faculty (admin only)
router.get('/faculty/all', authenticateToken, authorize('admin'), async (req, res) => {
  try {
    const { page = 1, limit = 10, department } = req.query;

    const query = { role: 'faculty' };

    if (department) {
      query['facultyInfo.department'] = department;
    }

    const faculty = await User.find(query)
      .select('-password')
      .sort({ 'facultyInfo.employeeId': 1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await User.countDocuments(query);

    res.json({
      faculty,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    console.error('Get all faculty error:', error);
    res.status(500).json({
      message: 'Failed to get faculty',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Get all employers (admin only)
router.get('/employers/all', authenticateToken, authorize('admin'), async (req, res) => {
  try {
    const { page = 1, limit = 10, industry, isVerified } = req.query;

    const query = { role: 'employer' };

    if (industry) {
      query['employerInfo.industry'] = industry;
    }

    if (isVerified !== undefined) {
      query['employerInfo.isVerified'] = isVerified === 'true';
    }

    const employers = await User.find(query)
      .select('-password')
      .sort({ 'employerInfo.companyName': 1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await User.countDocuments(query);

    res.json({
      employers,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    console.error('Get all employers error:', error);
    res.status(500).json({
      message: 'Failed to get employers',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Verify employer (admin only)
router.put('/employers/:userId/verify', authenticateToken, authorize('admin'), async (req, res) => {
  try {
    const { userId } = req.params;
    const { isVerified } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        message: 'User not found'
      });
    }

    if (user.role !== 'employer') {
      return res.status(400).json({
        message: 'User is not an employer'
      });
    }

    user.employerInfo.isVerified = isVerified;
    await user.save();

    res.json({
      message: `Employer ${isVerified ? 'verified' : 'unverified'} successfully`,
      user: user.getPublicProfile()
    });
  } catch (error) {
    console.error('Verify employer error:', error);
    res.status(500).json({
      message: 'Failed to verify employer',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

module.exports = router;
