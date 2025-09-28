const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Verify JWT token
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({ 
        message: 'Access token required' 
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select('-password');
    
    if (!user) {
      return res.status(401).json({ 
        message: 'Invalid token - user not found' 
      });
    }

    if (!user.isActive) {
      return res.status(401).json({ 
        message: 'Account is deactivated' 
      });
    }

    if (user.isLocked) {
      return res.status(401).json({ 
        message: 'Account is locked due to multiple failed login attempts' 
      });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        message: 'Invalid token' 
      });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        message: 'Token expired' 
      });
    }
    console.error('Auth middleware error:', error);
    res.status(500).json({ 
      message: 'Authentication error' 
    });
  }
};

// Check if user has required role
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ 
        message: 'Authentication required' 
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ 
        message: 'Insufficient permissions' 
      });
    }

    next();
  };
};

// Check if user is the owner of the resource or has admin role
const authorizeOwnerOrAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ 
      message: 'Authentication required' 
    });
  }

  const resourceUserId = req.params.userId || req.body.userId;
  
  if (req.user.role === 'admin' || req.user._id.toString() === resourceUserId) {
    next();
  } else {
    res.status(403).json({ 
      message: 'Access denied - insufficient permissions' 
    });
  }
};

// Check if user can access job applications
const authorizeJobAccess = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ 
        message: 'Authentication required' 
      });
    }

    const jobId = req.params.jobId || req.body.jobId;
    
    if (req.user.role === 'admin') {
      return next();
    }

    if (req.user.role === 'employer') {
      // Check if user is the job poster
      const Job = require('../models/Job');
      const job = await Job.findById(jobId);
      
      if (!job) {
        return res.status(404).json({ 
          message: 'Job not found' 
        });
      }

      if (job.postedBy.toString() !== req.user._id.toString()) {
        return res.status(403).json({ 
          message: 'Access denied - not authorized to view this job' 
        });
      }
    }

    if (req.user.role === 'student') {
      // Students can only view their own applications
      const applicationId = req.params.applicationId || req.body.applicationId;
      if (applicationId) {
        const Application = require('../models/Application');
        const application = await Application.findById(applicationId);
        
        if (!application) {
          return res.status(404).json({ 
            message: 'Application not found' 
          });
        }

        if (application.student.toString() !== req.user._id.toString()) {
          return res.status(403).json({ 
            message: 'Access denied - not authorized to view this application' 
          });
        }
      }
    }

    next();
  } catch (error) {
    console.error('Job access authorization error:', error);
    res.status(500).json({ 
      message: 'Authorization error' 
    });
  }
};

// Check if user can access application
const authorizeApplicationAccess = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ 
        message: 'Authentication required' 
      });
    }

    const applicationId = req.params.applicationId || req.body.applicationId;
    
    if (!applicationId) {
      return res.status(400).json({ 
        message: 'Application ID required' 
      });
    }

    const Application = require('../models/Application');
    const application = await Application.findById(applicationId)
      .populate('job', 'postedBy')
      .populate('student');

    if (!application) {
      return res.status(404).json({ 
        message: 'Application not found' 
      });
    }

    // Admin can access all applications
    if (req.user.role === 'admin') {
      req.application = application;
      return next();
    }

    // Student can access their own applications
    if (req.user.role === 'student' && 
        application.student._id.toString() === req.user._id.toString()) {
      req.application = application;
      return next();
    }

    // Employer can access applications for their jobs
    if (req.user.role === 'employer' && 
        application.job.postedBy.toString() === req.user._id.toString()) {
      req.application = application;
      return next();
    }

    // Faculty can access applications they need to approve
    if (req.user.role === 'faculty') {
      req.application = application;
      return next();
    }

    res.status(403).json({ 
      message: 'Access denied - insufficient permissions' 
    });
  } catch (error) {
    console.error('Application access authorization error:', error);
    res.status(500).json({ 
      message: 'Authorization error' 
    });
  }
};

// Rate limiting for sensitive operations
const rateLimitSensitive = (req, res, next) => {
  // This would integrate with express-rate-limit for specific routes
  next();
};

// Validate email verification
const requireEmailVerification = (req, res, next) => {
  if (!req.user.isEmailVerified) {
    return res.status(403).json({ 
      message: 'Email verification required',
      code: 'EMAIL_NOT_VERIFIED'
    });
  }
  next();
};

// Check account lock status
const checkAccountLock = (req, res, next) => {
  if (req.user.isLocked) {
    return res.status(423).json({ 
      message: 'Account is locked due to multiple failed login attempts',
      lockUntil: req.user.lockUntil
    });
  }
  next();
};

module.exports = {
  authenticateToken,
  authorize,
  authorizeOwnerOrAdmin,
  authorizeJobAccess,
  authorizeApplicationAccess,
  rateLimitSensitive,
  requireEmailVerification,
  checkAccountLock
};
